use std::net::SocketAddr;

use alloy_control::agent_tunnel;
use alloy_control::auth;
use alloy_control::node_health::NodeHealthPoller;
use alloy_control::request_meta::RequestMeta;
use alloy_control::rpc;
use alloy_control::security;
use alloy_control::state::AppState;
use axum::extract::{DefaultBodyLimit, Multipart, Query, State};
use axum::http::StatusCode;
use axum::middleware;
use axum::{
    Extension, Json, Router,
    routing::{get, post},
};
use sea_orm_migration::MigratorTrait;
use serde::Serialize;

#[derive(Debug, serde::Deserialize)]
struct ModpackPacksQuery {
    node_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct ModpackPackItem {
    name: String,
    path: String,
    size_bytes: String,
    modified_unix_ms: String,
}

#[derive(Debug, Serialize)]
struct ModpackPacksResponse {
    entries: Vec<ModpackPackItem>,
}

#[derive(Debug, Serialize)]
struct UploadModpackResponse {
    ok: bool,
    path: String,
    name: String,
    size_bytes: String,
}

#[derive(Debug, Serialize)]
struct HealthzPort {
    port: u32,
    available: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthzAgent {
    endpoint: String,
    ok: bool,
    status: Option<String>,
    agent_version: Option<String>,
    data_root: Option<String>,
    data_root_writable: Option<bool>,
    data_root_free_bytes: Option<u64>,
    ports: Option<Vec<HealthzPort>>,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct HealthzResponse {
    status: &'static str,
    version: &'static str,
    read_only: bool,
    agent: HealthzAgent,
}

async fn healthz(State(_state): State<AppState>) -> Json<HealthzResponse> {
    let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());

    let transport = alloy_control::agent_transport::AgentTransport::new(_state.agent_hub.clone());
    let agent = match transport
        .call::<_, alloy_proto::agent_v1::HealthCheckResponse>(
            "/alloy.agent.v1.AgentHealthService/Check",
            alloy_proto::agent_v1::HealthCheckRequest {},
        )
        .await
    {
        Ok(resp) => HealthzAgent {
            endpoint: agent_endpoint,
            ok: true,
            status: Some(resp.status),
            agent_version: Some(resp.agent_version),
            data_root: Some(resp.data_root),
            data_root_writable: Some(resp.data_root_writable),
            data_root_free_bytes: Some(resp.data_root_free_bytes),
            ports: Some(
                resp.ports
                    .into_iter()
                    .map(|p| HealthzPort {
                        port: p.port,
                        available: p.available,
                        error: if p.error.is_empty() {
                            None
                        } else {
                            Some(p.error)
                        },
                    })
                    .collect(),
            ),
            error: None,
        },
        Err(e) => HealthzAgent {
            endpoint: agent_endpoint,
            ok: false,
            status: None,
            agent_version: None,
            data_root: None,
            data_root_writable: None,
            data_root_free_bytes: None,
            ports: None,
            error: Some(e.to_string()),
        },
    };

    Json(HealthzResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        read_only: std::env::var("ALLOY_READ_ONLY").is_ok_and(|v| {
            matches!(
                v.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        }),
        agent,
    })
}

#[derive(Debug, Serialize)]
struct UploadSaveErrorBody {
    message: String,
    request_id: String,
}

#[derive(Debug, Serialize)]
struct UploadSaveResponse {
    ok: bool,
    message: String,
    installed_path: String,
    backup_path: String,
}

fn upload_error(
    status: StatusCode,
    request_id: &str,
    message: impl Into<String>,
) -> (StatusCode, Json<UploadSaveErrorBody>) {
    (
        status,
        Json(UploadSaveErrorBody {
            message: message.into(),
            request_id: request_id.to_string(),
        }),
    )
}

fn status_code_from_agent(status: &tonic::Status) -> StatusCode {
    match status.code() {
        tonic::Code::InvalidArgument
        | tonic::Code::FailedPrecondition
        | tonic::Code::OutOfRange
        | tonic::Code::AlreadyExists => StatusCode::BAD_REQUEST,
        tonic::Code::NotFound => StatusCode::NOT_FOUND,
        tonic::Code::PermissionDenied | tonic::Code::Unauthenticated => StatusCode::FORBIDDEN,
        tonic::Code::Unavailable | tonic::Code::DeadlineExceeded => StatusCode::SERVICE_UNAVAILABLE,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

async fn upload_instance_save(
    State(state): State<AppState>,
    Extension(meta): Extension<RequestMeta>,
    Extension(_user): Extension<rpc::AuthUser>,
    mut multipart: Multipart,
) -> Result<Json<UploadSaveResponse>, (StatusCode, Json<UploadSaveErrorBody>)> {
    if std::env::var("ALLOY_READ_ONLY").is_ok_and(|v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    }) {
        return Err(upload_error(
            StatusCode::FORBIDDEN,
            &meta.request_id,
            "control is in read-only mode",
        ));
    }

    let mut instance_id: Option<String> = None;
    let mut upload_rel_path: Option<String> = None;
    let mut upload_started = false;
    let mut wrote_any_chunk = false;
    let mut total_size: u64 = 0;
    let mut offset: u64 = 0;
    const MAX_UPLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
    const CHUNK_SIZE: usize = 512 * 1024;

    let mut transport_opt: Option<alloy_control::agent_transport::AgentTransport> = None;

    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        upload_error(
            StatusCode::BAD_REQUEST,
            &meta.request_id,
            format!("invalid multipart: {e}"),
        )
    })? {
        let Some(name) = field.name() else {
            continue;
        };

        if name == "instance_id" {
            let text = field.text().await.map_err(|e| {
                upload_error(
                    StatusCode::BAD_REQUEST,
                    &meta.request_id,
                    format!("invalid instance_id field: {e}"),
                )
            })?;
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Err(upload_error(
                    StatusCode::BAD_REQUEST,
                    &meta.request_id,
                    "instance_id is required",
                ));
            }
            instance_id = Some(trimmed.to_string());
            continue;
        }

        if name != "file" {
            continue;
        }

        if upload_started {
            return Err(upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                "only one file is allowed",
            ));
        }
        upload_started = true;

        let instance_id_val = instance_id.clone().ok_or_else(|| {
            upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                "instance_id must be provided before file field",
            )
        })?;

        let ctx = rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: Some(_user.clone()),
            request_id: meta.request_id.clone(),
        };
        let transport = rpc::instance_transport_for_external(&ctx, &instance_id_val)
            .await
            .map_err(|e| {
                upload_error(
                    StatusCode::BAD_REQUEST,
                    &meta.request_id,
                    format!("failed to resolve target node: {}", e.message),
                )
            })?;

        let info: alloy_proto::agent_v1::GetInstanceResponse = transport
            .call(
                "/alloy.agent.v1.InstanceService/Get",
                alloy_proto::agent_v1::GetInstanceRequest {
                    instance_id: instance_id_val.clone(),
                },
            )
            .await
            .map_err(|status| {
                upload_error(
                    status_code_from_agent(&status),
                    &meta.request_id,
                    format!("instance.get failed: {}", status.message()),
                )
            })?;

        let template_id = info
            .info
            .and_then(|v| v.config)
            .map(|cfg| cfg.template_id)
            .unwrap_or_default();
        if !matches!(
            template_id.as_str(),
            "minecraft:vanilla"
                | "minecraft:modrinth"
                | "minecraft:import"
                | "minecraft:curseforge"
        ) {
            return Err(upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                "file upload import is currently supported for Minecraft instances only",
            ));
        }

        let filename = field
            .file_name()
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "save.zip".to_string());
        let safe_filename = {
            let s = filename
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>();
            if s.is_empty() {
                "save.zip".to_string()
            } else {
                s
            }
        };

        let nonce = alloy_process::ProcessId::new().0;
        let upload_rel =
            format!("instances/{instance_id_val}/imports/upload-{nonce}-{safe_filename}");

        let _mkdir_resp: alloy_proto::agent_v1::MkdirResponse = transport
            .call(
                "/alloy.agent.v1.FilesystemService/Mkdir",
                alloy_proto::agent_v1::MkdirRequest {
                    path: format!("instances/{instance_id_val}/imports"),
                    recursive: true,
                },
            )
            .await
            .map_err(|status| {
                upload_error(
                    status_code_from_agent(&status),
                    &meta.request_id,
                    format!("failed to prepare upload dir: {}", status.message()),
                )
            })?;

        while let Some(chunk) = field.chunk().await.map_err(|e| {
            upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                format!("failed to read upload stream: {e}"),
            )
        })? {
            let mut consumed = 0usize;
            while consumed < chunk.len() {
                let end = (consumed + CHUNK_SIZE).min(chunk.len());
                let part = &chunk[consumed..end];
                total_size = total_size.saturating_add(part.len() as u64);
                if total_size > MAX_UPLOAD_BYTES {
                    return Err(upload_error(
                        StatusCode::BAD_REQUEST,
                        &meta.request_id,
                        "upload too large",
                    ));
                }

                let _write_resp: alloy_proto::agent_v1::WriteFileResponse = transport
                    .call(
                        "/alloy.agent.v1.FilesystemService/WriteFile",
                        alloy_proto::agent_v1::WriteFileRequest {
                            path: upload_rel.clone(),
                            data: part.to_vec(),
                            offset,
                            truncate: offset == 0,
                        },
                    )
                    .await
                    .map_err(|status| {
                        upload_error(
                            status_code_from_agent(&status),
                            &meta.request_id,
                            format!("upload failed: {}", status.message()),
                        )
                    })?;

                offset = offset.saturating_add(part.len() as u64);
                consumed = end;
                wrote_any_chunk = true;
            }
        }

        transport_opt = Some(transport);
        upload_rel_path = Some(upload_rel);
    }

    if instance_id.is_none() {
        return Err(upload_error(
            StatusCode::BAD_REQUEST,
            &meta.request_id,
            "instance_id is required",
        ));
    }
    if !upload_started || !wrote_any_chunk {
        return Err(upload_error(
            StatusCode::BAD_REQUEST,
            &meta.request_id,
            "file is required",
        ));
    }

    let instance_id_val = instance_id.unwrap_or_default();
    let upload_rel = upload_rel_path.unwrap_or_default();
    let transport = transport_opt.ok_or_else(|| {
        upload_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &meta.request_id,
            "upload transport unavailable",
        )
    })?;

    let resp: alloy_proto::agent_v1::ImportSaveFromUrlResponse = transport
        .call(
            "/alloy.agent.v1.InstanceService/ImportSaveFromPath",
            alloy_proto::agent_v1::ImportSaveFromPathRequest {
                instance_id: instance_id_val,
                path: upload_rel,
            },
        )
        .await
        .map_err(|status| {
            upload_error(
                status_code_from_agent(&status),
                &meta.request_id,
                format!("import failed: {}", status.message()),
            )
        })?;

    Ok(Json(UploadSaveResponse {
        ok: resp.ok,
        message: resp.message,
        installed_path: resp.installed_path,
        backup_path: resp.backup_path,
    }))
}

async fn list_modpack_packs(
    State(state): State<AppState>,
    Extension(meta): Extension<RequestMeta>,
    Extension(user): Extension<rpc::AuthUser>,
    Query(query): Query<ModpackPacksQuery>,
) -> Result<Json<ModpackPacksResponse>, (StatusCode, Json<UploadSaveErrorBody>)> {
    let ctx = rpc::Ctx {
        db: state.db.clone(),
        agent_hub: state.agent_hub.clone(),
        user: Some(user),
        request_id: meta.request_id.clone(),
    };

    let transport = rpc::create_transport_for_external(&ctx, query.node_id)
        .await
        .map_err(|e| {
            upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                format!("failed to resolve target node: {}", e.message),
            )
        })?;

    let dir = "uploads/modpacks".to_string();
    let resp = transport
        .call::<_, alloy_proto::agent_v1::ListDirResponse>(
            "/alloy.agent.v1.FilesystemService/ListDir",
            alloy_proto::agent_v1::ListDirRequest {
                path: dir.clone(),
            },
        )
        .await;

    let list = match resp {
        Ok(v) => v,
        Err(status) if status.code() == tonic::Code::NotFound => {
            return Ok(Json(ModpackPacksResponse {
                entries: Vec::new(),
            }));
        }
        Err(status) => {
            return Err(upload_error(
                status_code_from_agent(&status),
                &meta.request_id,
                format!("failed to list modpack packs: {}", status.message()),
            ));
        }
    };

    let mut entries = list
        .entries
        .into_iter()
        .filter(|e| {
            !e.is_dir
                && e.name
                    .to_ascii_lowercase()
                    .ends_with(".zip")
        })
        .map(|e| ModpackPackItem {
            path: format!("{}/{}", dir, e.name),
            name: e.name,
            size_bytes: e.size_bytes.to_string(),
            modified_unix_ms: e.modified_unix_ms.to_string(),
        })
        .collect::<Vec<_>>();

    entries.sort_by(|a, b| b.modified_unix_ms.cmp(&a.modified_unix_ms));
    Ok(Json(ModpackPacksResponse { entries }))
}

async fn upload_modpack_pack(
    State(state): State<AppState>,
    Extension(meta): Extension<RequestMeta>,
    Extension(user): Extension<rpc::AuthUser>,
    mut multipart: Multipart,
) -> Result<Json<UploadModpackResponse>, (StatusCode, Json<UploadSaveErrorBody>)> {
    if std::env::var("ALLOY_READ_ONLY").is_ok_and(|v| {
        matches!(
            v.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        )
    }) {
        return Err(upload_error(
            StatusCode::FORBIDDEN,
            &meta.request_id,
            "control is in read-only mode",
        ));
    }

    let mut node_id: Option<String> = None;
    let mut upload_started = false;
    let mut wrote_any_chunk = false;
    let mut total_size: u64 = 0;
    let mut offset: u64 = 0;
    const MAX_UPLOAD_BYTES: u64 = 8 * 1024 * 1024 * 1024;
    const CHUNK_SIZE: usize = 512 * 1024;

    let mut transport_opt: Option<alloy_control::agent_transport::AgentTransport> = None;
    let mut upload_rel_path: Option<String> = None;
    let mut final_name: Option<String> = None;

    while let Some(mut field) = multipart.next_field().await.map_err(|e| {
        upload_error(
            StatusCode::BAD_REQUEST,
            &meta.request_id,
            format!("invalid multipart: {e}"),
        )
    })? {
        let Some(name) = field.name() else {
            continue;
        };

        if name == "node_id" {
            let text = field.text().await.map_err(|e| {
                upload_error(
                    StatusCode::BAD_REQUEST,
                    &meta.request_id,
                    format!("invalid node_id field: {e}"),
                )
            })?;
            let trimmed = text.trim();
            node_id = if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            };
            continue;
        }

        if name != "file" {
            continue;
        }

        if upload_started {
            return Err(upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                "only one file is allowed",
            ));
        }
        upload_started = true;

        let ctx = rpc::Ctx {
            db: state.db.clone(),
            agent_hub: state.agent_hub.clone(),
            user: Some(user.clone()),
            request_id: meta.request_id.clone(),
        };
        let transport = rpc::create_transport_for_external(&ctx, node_id.clone())
            .await
            .map_err(|e| {
                upload_error(
                    StatusCode::BAD_REQUEST,
                    &meta.request_id,
                    format!("failed to resolve target node: {}", e.message),
                )
            })?;

        let filename = field
            .file_name()
            .map(|s| s.trim().to_string())
            .unwrap_or_else(|| "modpack.zip".to_string());
        let safe_filename = {
            let s = filename
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>();
            if s.is_empty() {
                "modpack.zip".to_string()
            } else {
                s
            }
        };
        if !safe_filename.to_ascii_lowercase().ends_with(".zip") {
            return Err(upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                "only .zip files are allowed",
            ));
        }

        let nonce = alloy_process::ProcessId::new().0;
        let final_file = format!("modpack-{nonce}-{safe_filename}");
        let upload_rel = format!("uploads/modpacks/{final_file}");

        let _mkdir_resp: alloy_proto::agent_v1::MkdirResponse = transport
            .call(
                "/alloy.agent.v1.FilesystemService/Mkdir",
                alloy_proto::agent_v1::MkdirRequest {
                    path: "uploads/modpacks".to_string(),
                    recursive: true,
                },
            )
            .await
            .map_err(|status| {
                upload_error(
                    status_code_from_agent(&status),
                    &meta.request_id,
                    format!("failed to prepare upload dir: {}", status.message()),
                )
            })?;

        while let Some(chunk) = field.chunk().await.map_err(|e| {
            upload_error(
                StatusCode::BAD_REQUEST,
                &meta.request_id,
                format!("failed to read upload stream: {e}"),
            )
        })? {
            let mut consumed = 0usize;
            while consumed < chunk.len() {
                let end = (consumed + CHUNK_SIZE).min(chunk.len());
                let part = &chunk[consumed..end];
                total_size = total_size.saturating_add(part.len() as u64);
                if total_size > MAX_UPLOAD_BYTES {
                    return Err(upload_error(
                        StatusCode::BAD_REQUEST,
                        &meta.request_id,
                        "upload too large",
                    ));
                }

                let _write_resp: alloy_proto::agent_v1::WriteFileResponse = transport
                    .call(
                        "/alloy.agent.v1.FilesystemService/WriteFile",
                        alloy_proto::agent_v1::WriteFileRequest {
                            path: upload_rel.clone(),
                            data: part.to_vec(),
                            offset,
                            truncate: offset == 0,
                        },
                    )
                    .await
                    .map_err(|status| {
                        upload_error(
                            status_code_from_agent(&status),
                            &meta.request_id,
                            format!("upload failed: {}", status.message()),
                        )
                    })?;

                offset = offset.saturating_add(part.len() as u64);
                consumed = end;
                wrote_any_chunk = true;
            }
        }

        transport_opt = Some(transport);
        upload_rel_path = Some(upload_rel);
        final_name = Some(final_file);
    }

    if !upload_started || !wrote_any_chunk {
        return Err(upload_error(
            StatusCode::BAD_REQUEST,
            &meta.request_id,
            "file is required",
        ));
    }

    let _transport = transport_opt.ok_or_else(|| {
        upload_error(
            StatusCode::INTERNAL_SERVER_ERROR,
            &meta.request_id,
            "upload transport unavailable",
        )
    })?;

    Ok(Json(UploadModpackResponse {
        ok: true,
        path: upload_rel_path.unwrap_or_default(),
        name: final_name.unwrap_or_else(|| "modpack.zip".to_string()),
        size_bytes: total_size.to_string(),
    }))
}

async fn cleanup_legacy_default_node(db: &sea_orm::DatabaseConnection) -> anyhow::Result<()> {
    use alloy_db::entities::{instance_nodes, instances, nodes};
    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

    let Some(endpoint) = std::env::var("ALLOY_AGENT_ENDPOINT")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    else {
        return Ok(());
    };

    let legacy_rows = nodes::Entity::find()
        .filter(nodes::Column::Name.eq("default"))
        .filter(nodes::Column::Endpoint.eq(endpoint.clone()))
        .filter(nodes::Column::ConnectTokenHash.is_null())
        .all(db)
        .await?;

    for row in legacy_rows {
        let in_use_by_targets = instance_nodes::Entity::find()
            .filter(instance_nodes::Column::NodeId.eq(row.id))
            .one(db)
            .await?
            .is_some();

        let in_use_by_records = instances::Entity::find()
            .filter(instances::Column::NodeId.eq(row.id))
            .one(db)
            .await?
            .is_some();

        if in_use_by_targets || in_use_by_records {
            tracing::info!(
                node_id = %row.id,
                node_name = %row.name,
                "keeping legacy auto-seeded default node because it is referenced by instances"
            );
            continue;
        }

        let deleted = nodes::Entity::delete_by_id(row.id).exec(db).await?;
        if deleted.rows_affected > 0 {
            tracing::info!(
                node_id = %row.id,
                node_name = %row.name,
                endpoint = %row.endpoint,
                "removed legacy auto-seeded default node"
            );
        }
    }

    Ok(())
}

async fn init_db_and_migrate() -> anyhow::Result<AppState> {
    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let db = alloy_db::connect(&database_url).await?;

    // Apply migrations on boot (idempotent).
    alloy_migration::Migrator::up(&db, None).await?;

    // Security bootstrap: require strong JWT secret and initialize first admin account.
    auth::ensure_jwt_secret_configured()?;
    auth::bootstrap_initial_admin(&db).await?;

    // Legacy cleanup: old versions auto-seeded a local `default` node from ALLOY_AGENT_ENDPOINT.
    // Keep user-created nodes untouched and only remove the exact auto-seeded shape.
    if let Err(err) = cleanup_legacy_default_node(&db).await {
        tracing::warn!(error = %err, "failed to cleanup legacy default node");
    }

    Ok(AppState {
        db: std::sync::Arc::new(db),
        agent_hub: agent_tunnel::AgentHub::new(),
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let state = init_db_and_migrate().await?;

    NodeHealthPoller::new(state.db.clone(), state.agent_hub.clone()).spawn();
    rpc::init_download_queue_runtime(state.db.clone(), state.agent_hub.clone());

    let router = rpc::router();
    let (procedures, _types) = router
        .build()
        .map_err(|errs| anyhow::anyhow!("rspc build failed: {errs:?}"))?;

    // State-changing auth routes are protected by CSRF double-submit + Origin allowlist.
    let auth_router = Router::new()
        .route("/csrf", get(auth::csrf))
        .route("/login", post(auth::login))
        .route("/change-credentials", post(auth::change_credentials))
        .route("/refresh", post(auth::refresh))
        .route("/logout", post(auth::logout))
        .layer(middleware::from_fn(security::csrf_and_origin))
        .with_state(state.clone());

    // Protect /rspc procedures with JWT cookie; allowlist health procedures.
    let rspc_router = rspc_axum::endpoint(
        procedures,
        |axum::extract::State(state): axum::extract::State<AppState>,
         axum::extract::Extension(meta): axum::extract::Extension<RequestMeta>,
         user: Option<axum::Extension<rpc::AuthUser>>| {
            rpc::Ctx {
                db: state.db.clone(),
                agent_hub: state.agent_hub.clone(),
                user: user.map(|axum::Extension(u)| u),
                request_id: meta.request_id,
            }
        },
    )
    .layer(middleware::from_fn(security::rspc_auth_guard));

    let instance_router = Router::new()
        .route("/upload-save", post(upload_instance_save))
        .route("/upload-modpack", post(upload_modpack_pack))
        .route("/modpack-packs", get(list_modpack_packs))
        .layer(DefaultBodyLimit::max(512 * 1024 * 1024))
        .layer(middleware::from_fn(security::csrf_and_origin))
        .layer(middleware::from_fn(security::rspc_auth_guard))
        .with_state(state.clone());

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/whoami", get(auth::whoami))
        .route("/agent/ws", get(agent_tunnel::agent_ws))
        .route("/agent/poll", get(agent_tunnel::agent_poll))
        .route("/agent/resp", post(agent_tunnel::agent_resp))
        .nest("/auth", auth_router)
        .nest("/instance", instance_router)
        .nest("/rspc", rspc_router)
        .layer(middleware::from_fn(security::request_id))
        .with_state(state);
    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!(%addr, "alloy-control HTTP listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
