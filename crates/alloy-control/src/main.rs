use std::net::SocketAddr;

use alloy_control::agent_tunnel;
use alloy_control::auth;
use alloy_control::node_health::NodeHealthPoller;
use alloy_control::request_meta::RequestMeta;
use alloy_control::rpc;
use alloy_control::security;
use alloy_control::state::AppState;
use axum::extract::State;
use axum::middleware;
use axum::{
    Json, Router,
    routing::{get, post},
};
use sea_orm::EntityTrait;
use sea_orm_migration::MigratorTrait;
use serde::Serialize;

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

async fn init_db_and_migrate() -> anyhow::Result<AppState> {
    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let db = alloy_db::connect(&database_url).await?;

    // Apply migrations on boot (idempotent).
    alloy_migration::Migrator::up(&db, None).await?;

    // Ensure the default node exists so the UI has something to show.
    // This is idempotent and safe to run on every boot.
    if let Ok(endpoint) = std::env::var("ALLOY_AGENT_ENDPOINT") {
        let _ = alloy_db::entities::nodes::Entity::insert(alloy_db::entities::nodes::ActiveModel {
            id: sea_orm::Set(sea_orm::prelude::Uuid::new_v4()),
            name: sea_orm::Set("default".to_string()),
            endpoint: sea_orm::Set(endpoint),
            connect_token_hash: sea_orm::Set(None),
            enabled: sea_orm::Set(true),
            last_seen_at: sea_orm::Set(None),
            agent_version: sea_orm::Set(None),
            last_error: sea_orm::Set(None),
            created_at: sea_orm::Set(chrono::Utc::now().into()),
            updated_at: sea_orm::Set(chrono::Utc::now().into()),
        })
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([alloy_db::entities::nodes::Column::Name])
                .update_columns([
                    alloy_db::entities::nodes::Column::Endpoint,
                    alloy_db::entities::nodes::Column::Enabled,
                    alloy_db::entities::nodes::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(&db)
        .await;
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

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/whoami", get(auth::whoami))
        .route("/agent/ws", get(agent_tunnel::agent_ws))
        .nest("/auth", auth_router)
        .nest("/rspc", rspc_router)
        .layer(middleware::from_fn(security::request_id))
        .with_state(state);
    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!(%addr, "alloy-control HTTP listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
