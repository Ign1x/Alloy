use alloy_proto::agent_v1::{
    CreateInstanceRequest, DeleteInstanceRequest, GetInstanceRequest, GetStatusRequest,
    HealthCheckRequest, ListDirRequest, ListInstancesRequest, ListProcessesRequest,
    ListTemplatesRequest, ReadFileRequest, StartFromTemplateRequest, StartInstanceRequest,
    StopInstanceRequest, StopProcessRequest, TailFileRequest, TailLogsRequest,
    UpdateInstanceRequest, agent_health_service_client::AgentHealthServiceClient,
    filesystem_service_client::FilesystemServiceClient,
    instance_service_client::InstanceServiceClient, logs_service_client::LogsServiceClient,
    process_service_client::ProcessServiceClient,
};
use rspc::{Procedure, ProcedureError, ResolverError, Router};
use tonic::Request;

use specta::Type;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use crate::audit;

#[derive(Clone, Debug, serde::Serialize, Type)]
pub struct AuthUser {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
}

// Request context for rspc procedures.
#[derive(Clone)]
pub struct Ctx {
    pub db: Arc<alloy_db::sea_orm::DatabaseConnection>,
    pub user: Option<AuthUser>,
    pub request_id: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub request_id: String,
}

impl rspc::Error for ApiError {
    fn into_procedure_error(self) -> ProcedureError {
        // Keep error payload intentionally minimal/safe for frontend.
        ResolverError::new(self, Option::<std::io::Error>::None).into()
    }
}

fn api_error(ctx: &Ctx, code: &str, message: impl Into<String>) -> ApiError {
    ApiError {
        code: code.to_string(),
        message: message.into(),
        request_id: ctx.request_id.clone(),
    }
}

fn is_read_only() -> bool {
    matches!(
        std::env::var("ALLOY_READ_ONLY")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn ensure_writable(ctx: &Ctx) -> Result<(), ApiError> {
    if is_read_only() {
        return Err(api_error(ctx, "READ_ONLY", "control is in read-only mode"));
    }
    Ok(())
}

struct RateLimiter {
    window: Duration,
    max_hits: usize,
    hits: std::sync::Mutex<HashMap<String, VecDeque<Instant>>>,
}

impl RateLimiter {
    fn global() -> &'static RateLimiter {
        static RL: OnceLock<RateLimiter> = OnceLock::new();
        RL.get_or_init(|| {
            let max_hits = std::env::var("ALLOY_RATE_LIMIT_MAX_HITS")
                .ok()
                .and_then(|v| v.parse::<usize>().ok())
                .unwrap_or(30)
                .clamp(1, 10_000);
            let window_ms = std::env::var("ALLOY_RATE_LIMIT_WINDOW_MS")
                .ok()
                .and_then(|v| v.parse::<u64>().ok())
                .unwrap_or(10_000)
                .clamp(1000, 600_000);
            RateLimiter {
                window: Duration::from_millis(window_ms),
                max_hits,
                hits: std::sync::Mutex::new(HashMap::new()),
            }
        })
    }

    fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        let mut map = self.hits.lock().unwrap_or_else(|e| e.into_inner());
        let q = map.entry(key.to_string()).or_default();
        while q
            .front()
            .is_some_and(|t| now.duration_since(*t) > self.window)
        {
            q.pop_front();
        }
        if q.len() >= self.max_hits {
            return false;
        }
        q.push_back(now);
        true
    }
}

fn rate_limit_key(ctx: &Ctx) -> String {
    ctx.user
        .as_ref()
        .map(|u| format!("user:{}", u.user_id))
        .unwrap_or_else(|| "anon".to_string())
}

fn enforce_rate_limit(ctx: &Ctx) -> Result<(), ApiError> {
    let key = rate_limit_key(ctx);
    if !RateLimiter::global().allow(&key) {
        return Err(api_error(ctx, "RATE_LIMITED", "too many requests"));
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct PingResponse {
    pub status: String,
    pub version: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct AgentHealthResponse {
    pub status: String,
    pub agent_version: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessTemplateDto {
    pub template_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessStatusDto {
    pub process_id: String,
    pub template_id: String,
    pub state: String,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct StartProcessInput {
    pub template_id: String,
    pub params: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct StopProcessInput {
    pub process_id: String,
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct GetStatusInput {
    pub process_id: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct TailLogsInput {
    pub process_id: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct TailLogsOutput {
    pub lines: Vec<String>,
    pub next_cursor: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct ListDirInput {
    pub path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DirEntryDto {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u32,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ListDirOutput {
    pub entries: Vec<DirEntryDto>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct ReadFileInput {
    pub path: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ReadFileOutput {
    // For MVP: return as UTF-8 text (logs/config). Binary files are not supported yet.
    pub text: String,
    pub size_bytes: u32,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct TailFileInput {
    pub path: String,
    pub cursor: Option<String>,
    pub limit_bytes: Option<u32>,
    pub max_lines: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct TailFileOutput {
    pub lines: Vec<String>,
    pub next_cursor: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct NodeDto {
    pub id: String,
    pub name: String,
    pub endpoint: String,
    pub enabled: bool,
    pub last_seen_at: Option<String>,
    pub agent_version: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct CreateInstanceInput {
    pub template_id: String,
    pub params: std::collections::BTreeMap<String, String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct InstanceConfigDto {
    pub instance_id: String,
    pub template_id: String,
    pub params: std::collections::BTreeMap<String, String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct InstanceInfoDto {
    pub config: InstanceConfigDto,
    pub status: Option<ProcessStatusDto>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct InstanceIdInput {
    pub instance_id: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct StopInstanceInput {
    pub instance_id: String,
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct RestartInstanceInput {
    pub instance_id: String,
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct InstanceDiagnosticsInput {
    pub instance_id: String,
    pub max_lines: Option<u32>,
    pub limit_bytes: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct InstanceDiagnosticsOutput {
    pub instance_id: String,
    pub fetched_at_unix_ms: String,
    pub request_id: String,
    pub instance_json: Option<String>,
    pub run_json: Option<String>,
    pub console_log_lines: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct UpdateInstanceInput {
    pub instance_id: String,
    pub params: std::collections::BTreeMap<String, String>,
    pub display_name: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DeleteInstanceOutput {
    pub ok: bool,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct NodeSetEnabledInput {
    pub node_id: String,
    pub enabled: bool,
}

fn map_instance_config(cfg: alloy_proto::agent_v1::InstanceConfig) -> InstanceConfigDto {
    InstanceConfigDto {
        instance_id: cfg.instance_id,
        template_id: cfg.template_id,
        params: cfg.params.into_iter().collect(),
        display_name: if cfg.display_name.trim().is_empty() {
            None
        } else {
            Some(cfg.display_name)
        },
    }
}

fn map_instance_info(
    ctx: &Ctx,
    info: alloy_proto::agent_v1::InstanceInfo,
) -> Result<InstanceInfoDto, ApiError> {
    let cfg = info
        .config
        .ok_or_else(|| api_error(ctx, "INTERNAL", "missing instance config"))?;

    Ok(InstanceInfoDto {
        config: map_instance_config(cfg),
        status: info.status.map(|p| ProcessStatusDto {
            process_id: p.process_id.clone(),
            template_id: p.template_id.clone(),
            state: p.state().as_str_name().to_string(),
            pid: if p.has_pid { Some(p.pid) } else { None },
            exit_code: if p.has_exit_code {
                Some(p.exit_code)
            } else {
                None
            },
            message: if p.message.is_empty() {
                None
            } else {
                Some(p.message)
            },
        }),
    })
}

fn clamp_u64_to_u32(v: u64) -> u32 {
    if v > u32::MAX as u64 {
        u32::MAX
    } else {
        v as u32
    }
}

pub fn router() -> Router<Ctx> {
    // NOTE: Procedure keys are nested segments. This keeps generated `web/src/bindings.ts`
    // valid TypeScript (no unquoted keys with dots), while the runtime request path still
    // flattens to "segment.segment".
    let control = Router::new().procedure(
        "ping",
        Procedure::builder::<ApiError>().query(|_, _: ()| async move {
            Ok(PingResponse {
                status: "ok".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            })
        }),
    );

    let agent = Router::new().procedure(
        "health",
        Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
            // Container-safe: do not hardcode localhost.
            //
            // Local dev default is http://127.0.0.1:50051.
            // In docker-compose, set ALLOY_AGENT_ENDPOINT=http://alloy-agent:50051.
            let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());

            let mut client = AgentHealthServiceClient::connect(agent_endpoint.clone())
                .await
                .map_err(|e| {
                    api_error(
                        &ctx,
                        "AGENT_CONNECT_FAILED",
                        format!("failed to connect agent ({agent_endpoint}): {e}"),
                    )
                })?;

            let resp = client
                .check(Request::new(HealthCheckRequest {}))
                .await
                .map_err(|e| {
                    api_error(
                        &ctx,
                        "AGENT_RPC_FAILED",
                        format!("agent health check failed: {e}"),
                    )
                })?;

            let resp = resp.into_inner();
            Ok(AgentHealthResponse {
                status: resp.status,
                agent_version: resp.agent_version,
            })
        }),
    );

    let process = Router::new()
        .procedure(
            "templates",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list_templates(Request::new(ListTemplatesRequest {}))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("list_templates failed: {e}"),
                        )
                    })?
                    .into_inner();

                Ok(resp
                    .templates
                    .into_iter()
                    .map(|t| ProcessTemplateDto {
                        template_id: t.template_id,
                        display_name: t.display_name,
                    })
                    .collect::<Vec<_>>())
            }),
        )
        .procedure(
            "list",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list_processes(Request::new(ListProcessesRequest {}))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("list_processes failed: {e}"),
                        )
                    })?
                    .into_inner();

                Ok(resp
                    .processes
                    .into_iter()
                    .map(|p| ProcessStatusDto {
                        process_id: p.process_id.clone(),
                        template_id: p.template_id.clone(),
                        state: p.state().as_str_name().to_string(),
                        pid: if p.has_pid { Some(p.pid) } else { None },
                        exit_code: if p.has_exit_code {
                            Some(p.exit_code)
                        } else {
                            None
                        },
                        message: if p.message.is_empty() {
                            None
                        } else {
                            Some(p.message)
                        },
                    })
                    .collect::<Vec<_>>())
            }),
        )
        .procedure(
            "start",
            Procedure::builder::<ApiError>().mutation(|ctx, input: StartProcessInput| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let req = StartFromTemplateRequest {
                    template_id: input.template_id,
                    params: input.params.into_iter().collect(),
                };

                let status = client
                    .start_from_template(Request::new(req))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("start_from_template failed: {e}"),
                        )
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing status"))?;

                audit::record(
                    &ctx,
                    "process.start",
                    &status.process_id,
                    Some(serde_json::json!({ "template_id": status.template_id })),
                )
                .await;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "stop",
            Procedure::builder::<ApiError>().mutation(|ctx, input: StopProcessInput| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let req = StopProcessRequest {
                    process_id: input.process_id,
                    timeout_ms: input.timeout_ms.unwrap_or(30_000),
                };

                let status = client
                    .stop(Request::new(req))
                    .await
                    .map_err(|e| api_error(&ctx, "AGENT_RPC_FAILED", format!("stop failed: {e}")))?
                    .into_inner()
                    .status
                    .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing status"))?;

                audit::record(
                    &ctx,
                    "process.stop",
                    &status.process_id,
                    Some(serde_json::json!({ "template_id": status.template_id })),
                )
                .await;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "status",
            Procedure::builder::<ApiError>().query(|ctx, input: GetStatusInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let status = client
                    .get_status(Request::new(GetStatusRequest {
                        process_id: input.process_id,
                    }))
                    .await
                    .map_err(|e| {
                        api_error(&ctx, "AGENT_RPC_FAILED", format!("get_status failed: {e}"))
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing status"))?;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "logsTail",
            Procedure::builder::<ApiError>().query(|ctx, input: TailLogsInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .tail_logs(Request::new(TailLogsRequest {
                        process_id: input.process_id,
                        limit: input.limit.unwrap_or(200),
                        cursor: input.cursor.unwrap_or_default(),
                    }))
                    .await
                    .map_err(|e| {
                        api_error(&ctx, "AGENT_RPC_FAILED", format!("tail_logs failed: {e}"))
                    })?
                    .into_inner();

                Ok(TailLogsOutput {
                    lines: resp.lines,
                    next_cursor: resp.next_cursor,
                })
            }),
        );

    let fs = Router::new()
        .procedure(
            "listDir",
            Procedure::builder::<ApiError>().query(|ctx, input: ListDirInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = FilesystemServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list_dir(Request::new(ListDirRequest {
                        path: input.path.unwrap_or_default(),
                    }))
                    .await
                    .map_err(|e| {
                        api_error(&ctx, "AGENT_RPC_FAILED", format!("list_dir failed: {e}"))
                    })?
                    .into_inner();

                Ok(ListDirOutput {
                    entries: resp
                        .entries
                        .into_iter()
                        .map(|e| DirEntryDto {
                            name: e.name,
                            is_dir: e.is_dir,
                            size_bytes: clamp_u64_to_u32(e.size_bytes),
                        })
                        .collect(),
                })
            }),
        )
        .procedure(
            "readFile",
            Procedure::builder::<ApiError>().query(|ctx, input: ReadFileInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = FilesystemServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .read_file(Request::new(ReadFileRequest {
                        path: input.path,
                        offset: input.offset.unwrap_or(0) as u64,
                        limit: input.limit.unwrap_or(0) as u64,
                    }))
                    .await
                    .map_err(|e| {
                        api_error(&ctx, "AGENT_RPC_FAILED", format!("read_file failed: {e}"))
                    })?
                    .into_inner();

                let text = String::from_utf8(resp.data)
                    .map_err(|_| api_error(&ctx, "INVALID_UTF8", "file is not valid utf-8"))?;

                Ok(ReadFileOutput {
                    text,
                    size_bytes: clamp_u64_to_u32(resp.size_bytes),
                })
            }),
        );

    let log = Router::new().procedure(
        "tailFile",
        Procedure::builder::<ApiError>().query(|ctx, input: TailFileInput| async move {
            let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
            let mut client = LogsServiceClient::connect(agent_endpoint.clone())
                .await
                .map_err(|e| {
                    api_error(
                        &ctx,
                        "AGENT_CONNECT_FAILED",
                        format!("failed to connect agent ({agent_endpoint}): {e}"),
                    )
                })?;

            let resp = client
                .tail_file(Request::new(TailFileRequest {
                    path: input.path,
                    cursor: input.cursor.unwrap_or_default(),
                    limit_bytes: input.limit_bytes.unwrap_or(0),
                    max_lines: input.max_lines.unwrap_or(0),
                }))
                .await
                .map_err(|e| api_error(&ctx, "AGENT_RPC_FAILED", format!("tail_file failed: {e}")))?
                .into_inner();

            Ok(TailFileOutput {
                lines: resp.lines,
                next_cursor: resp.next_cursor,
            })
        }),
    );

    let instance = Router::new()
        .procedure(
            "create",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: CreateInstanceInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                    let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_CONNECT_FAILED",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;

                    let resp = client
                        .create(Request::new(CreateInstanceRequest {
                            template_id: input.template_id,
                            params: input.params.into_iter().collect(),
                            display_name: input.display_name.unwrap_or_default(),
                        }))
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_RPC_FAILED",
                                format!("instance.create failed: {e}"),
                            )
                        })?
                        .into_inner();

                    let cfg = resp
                        .config
                        .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing instance config"))?;

                    audit::record(
                        &ctx,
                        "instance.create",
                        &cfg.instance_id,
                        Some(serde_json::json!({ "template_id": cfg.template_id })),
                    )
                    .await;

                    Ok(map_instance_config(cfg))
                },
            ),
        )
        .procedure(
            "get",
            Procedure::builder::<ApiError>().query(|ctx, input: InstanceIdInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .get(Request::new(GetInstanceRequest {
                        instance_id: input.instance_id,
                    }))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("instance.get failed: {e}"),
                        )
                    })?
                    .into_inner();

                let info = resp
                    .info
                    .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing instance info"))?;

                map_instance_info(&ctx, info)
            }),
        )
        .procedure(
            "list",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list(Request::new(ListInstancesRequest {}))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("instance.list failed: {e}"),
                        )
                    })?
                    .into_inner();

                let mut out = Vec::new();
                for info in resp.instances {
                    out.push(map_instance_info(&ctx, info)?);
                }
                Ok(out)
            }),
        )
        .procedure(
            "diagnostics",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: InstanceDiagnosticsInput| async move {
                    enforce_rate_limit(&ctx)?;

                    let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());

                    let mut fs_client = FilesystemServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_CONNECT_FAILED",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;
                    let mut logs_client = LogsServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_CONNECT_FAILED",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;

                    let instance_id = input.instance_id;
                    let max_lines = input.max_lines.unwrap_or(400).clamp(1, 2000);
                    let limit_bytes = input
                        .limit_bytes
                        .unwrap_or(256 * 1024)
                        .clamp(1024, 1024 * 1024);

                    let to_utf8 = |bytes: Vec<u8>| -> Result<String, ApiError> {
                        String::from_utf8(bytes)
                            .map_err(|_| api_error(&ctx, "INVALID_UTF8", "file is not valid utf-8"))
                    };

                    let instance_json = match fs_client
                        .read_file(Request::new(ReadFileRequest {
                            path: format!("instances/{}/instance.json", instance_id),
                            offset: 0,
                            limit: 1024 * 1024,
                        }))
                        .await
                    {
                        Ok(resp) => Some(to_utf8(resp.into_inner().data)?),
                        Err(status) => {
                            if status.code() == tonic::Code::NotFound {
                                None
                            } else {
                                return Err(api_error(
                                    &ctx,
                                    "AGENT_RPC_FAILED",
                                    format!("read instance.json failed: {status}"),
                                ));
                            }
                        }
                    };
                    let instance_json = instance_json.map(|raw| {
                        let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&raw) else {
                            return raw;
                        };
                        if let Some(params) = v.get_mut("params").and_then(|p| p.as_object_mut())
                            && params.contains_key("password")
                        {
                            params.insert(
                                "password".to_string(),
                                serde_json::Value::String("<redacted>".to_string()),
                            );
                        }
                        serde_json::to_string_pretty(&v).unwrap_or(raw)
                    });

                    let run_json = match fs_client
                        .read_file(Request::new(ReadFileRequest {
                            path: format!("instances/{}/run.json", instance_id),
                            offset: 0,
                            limit: 1024 * 1024,
                        }))
                        .await
                    {
                        Ok(resp) => Some(to_utf8(resp.into_inner().data)?),
                        Err(status) => {
                            if status.code() != tonic::Code::NotFound {
                                return Err(api_error(
                                    &ctx,
                                    "AGENT_RPC_FAILED",
                                    format!("read run.json failed: {status}"),
                                ));
                            }

                            match fs_client
                                .read_file(Request::new(ReadFileRequest {
                                    path: format!("processes/{}/run.json", instance_id),
                                    offset: 0,
                                    limit: 1024 * 1024,
                                }))
                                .await
                            {
                                Ok(resp) => Some(to_utf8(resp.into_inner().data)?),
                                Err(status) => {
                                    if status.code() == tonic::Code::NotFound {
                                        None
                                    } else {
                                        return Err(api_error(
                                            &ctx,
                                            "AGENT_RPC_FAILED",
                                            format!("read run.json failed: {status}"),
                                        ));
                                    }
                                }
                            }
                        }
                    };

                    let console_log_lines = match logs_client
                        .tail_file(Request::new(TailFileRequest {
                            path: format!("instances/{}/logs/console.log", instance_id),
                            cursor: "0".to_string(),
                            limit_bytes,
                            max_lines,
                        }))
                        .await
                    {
                        Ok(resp) => resp.into_inner().lines,
                        Err(status) => {
                            if status.code() != tonic::Code::NotFound {
                                return Err(api_error(
                                    &ctx,
                                    "AGENT_RPC_FAILED",
                                    format!("tail console.log failed: {status}"),
                                ));
                            }

                            match logs_client
                                .tail_file(Request::new(TailFileRequest {
                                    path: format!("processes/{}/logs/console.log", instance_id),
                                    cursor: "0".to_string(),
                                    limit_bytes,
                                    max_lines,
                                }))
                                .await
                            {
                                Ok(resp) => resp.into_inner().lines,
                                Err(status) => {
                                    if status.code() == tonic::Code::NotFound {
                                        Vec::new()
                                    } else {
                                        return Err(api_error(
                                            &ctx,
                                            "AGENT_RPC_FAILED",
                                            format!("tail console.log failed: {status}"),
                                        ));
                                    }
                                }
                            }
                        }
                    };

                    let fetched_at_unix_ms = chrono::Utc::now().timestamp_millis().to_string();

                    Ok(InstanceDiagnosticsOutput {
                        instance_id,
                        fetched_at_unix_ms,
                        request_id: ctx.request_id.clone(),
                        instance_json,
                        run_json,
                        console_log_lines,
                    })
                },
            ),
        )
        .procedure(
            "start",
            Procedure::builder::<ApiError>().mutation(|ctx, input: InstanceIdInput| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .start(Request::new(StartInstanceRequest {
                        instance_id: input.instance_id,
                    }))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("instance.start failed: {e}"),
                        )
                    })?
                    .into_inner();

                let status = resp
                    .status
                    .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing status"))?;

                audit::record(
                    &ctx,
                    "instance.start",
                    &status.process_id,
                    Some(serde_json::json!({ "template_id": status.template_id })),
                )
                .await;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "restart",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: RestartInstanceInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                    let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_CONNECT_FAILED",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;

                    // Best-effort: if the instance isn't running, the stop call may return NOT_FOUND.
                    // Treat that as "already stopped" and continue to start.
                    match client
                        .stop(Request::new(StopInstanceRequest {
                            instance_id: input.instance_id.clone(),
                            timeout_ms: input.timeout_ms.unwrap_or(30_000),
                        }))
                        .await
                    {
                        Ok(_) => {}
                        Err(status) => {
                            if status.code() != tonic::Code::NotFound {
                                return Err(api_error(
                                    &ctx,
                                    "AGENT_RPC_FAILED",
                                    format!("instance.stop failed: {status}"),
                                ));
                            }
                        }
                    }

                    let resp = client
                        .start(Request::new(StartInstanceRequest {
                            instance_id: input.instance_id,
                        }))
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_RPC_FAILED",
                                format!("instance.start failed: {e}"),
                            )
                        })?
                        .into_inner();

                    let status = resp
                        .status
                        .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing status"))?;

                    audit::record(
                        &ctx,
                        "instance.restart",
                        &status.process_id,
                        Some(serde_json::json!({ "template_id": status.template_id })),
                    )
                    .await;

                    Ok(ProcessStatusDto {
                        process_id: status.process_id.clone(),
                        template_id: status.template_id.clone(),
                        state: status.state().as_str_name().to_string(),
                        pid: if status.has_pid {
                            Some(status.pid)
                        } else {
                            None
                        },
                        exit_code: if status.has_exit_code {
                            Some(status.exit_code)
                        } else {
                            None
                        },
                        message: if status.message.is_empty() {
                            None
                        } else {
                            Some(status.message)
                        },
                    })
                },
            ),
        )
        .procedure(
            "stop",
            Procedure::builder::<ApiError>().mutation(|ctx, input: StopInstanceInput| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .stop(Request::new(StopInstanceRequest {
                        instance_id: input.instance_id,
                        timeout_ms: input.timeout_ms.unwrap_or(30_000),
                    }))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("instance.stop failed: {e}"),
                        )
                    })?
                    .into_inner();

                let status = resp
                    .status
                    .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing status"))?;

                audit::record(
                    &ctx,
                    "instance.stop",
                    &status.process_id,
                    Some(serde_json::json!({ "template_id": status.template_id })),
                )
                .await;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "update",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: UpdateInstanceInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                    let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_CONNECT_FAILED",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;

                    let resp = client
                        .update(Request::new(UpdateInstanceRequest {
                            instance_id: input.instance_id.clone(),
                            params: input.params.into_iter().collect(),
                            display_name: input.display_name.unwrap_or_default(),
                        }))
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "AGENT_RPC_FAILED",
                                format!("instance.update failed: {e}"),
                            )
                        })?
                        .into_inner();

                    let cfg = resp
                        .config
                        .ok_or_else(|| api_error(&ctx, "INTERNAL", "missing instance config"))?;

                    audit::record(
                        &ctx,
                        "instance.update",
                        &cfg.instance_id,
                        Some(serde_json::json!({ "template_id": cfg.template_id })),
                    )
                    .await;

                    Ok(map_instance_config(cfg))
                },
            ),
        )
        .procedure(
            "delete",
            Procedure::builder::<ApiError>().mutation(|ctx, input: InstanceIdInput| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_CONNECT_FAILED",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let instance_id = input.instance_id;
                let resp = client
                    .delete(Request::new(DeleteInstanceRequest {
                        instance_id: instance_id.clone(),
                    }))
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "AGENT_RPC_FAILED",
                            format!("instance.delete failed: {e}"),
                        )
                    })?
                    .into_inner();

                if resp.ok {
                    audit::record(&ctx, "instance.delete", &instance_id, None).await;
                }

                Ok(DeleteInstanceOutput { ok: resp.ok })
            }),
        );

    let node = Router::new()
        .procedure(
            "list",
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                use alloy_db::entities::nodes;
                use sea_orm::EntityTrait;

                let rows = nodes::Entity::find()
                    .all(&*ctx.db)
                    .await
                    .map_err(|e| api_error(&ctx, "DB_ERROR", format!("db error: {e}")))?;

                Ok(rows
                    .into_iter()
                    .map(|n| NodeDto {
                        id: n.id.to_string(),
                        name: n.name,
                        endpoint: n.endpoint,
                        enabled: n.enabled,
                        last_seen_at: n.last_seen_at.map(|t| t.to_rfc3339()),
                        agent_version: n.agent_version,
                        last_error: n.last_error,
                    })
                    .collect::<Vec<_>>())
            }),
        )
        .procedure(
            "setEnabled",
            Procedure::builder::<ApiError>().mutation(
                |ctx: Ctx, input: NodeSetEnabledInput| async move {
                    use alloy_db::entities::nodes;
                    use sea_orm::{ActiveModelTrait, EntityTrait, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "UNAUTHORIZED", "unauthorized"))?;
                    if !user.is_admin {
                        return Err(api_error(&ctx, "FORBIDDEN", "forbidden"));
                    }

                    let id = sea_orm::prelude::Uuid::parse_str(&input.node_id)
                        .map_err(|_| api_error(&ctx, "INVALID_ARGUMENT", "invalid node_id"))?;

                    let model = nodes::Entity::find_by_id(id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "DB_ERROR", format!("db error: {e}")))?
                        .ok_or_else(|| api_error(&ctx, "NOT_FOUND", "node not found"))?;

                    let mut active: nodes::ActiveModel = model.into();
                    active.enabled = Set(input.enabled);
                    let updated = active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "DB_ERROR", format!("db error: {e}")))?;

                    audit::record(
                        &ctx,
                        "node.setEnabled",
                        &updated.id.to_string(),
                        Some(serde_json::json!({ "enabled": updated.enabled })),
                    )
                    .await;

                    Ok(NodeDto {
                        id: updated.id.to_string(),
                        name: updated.name,
                        endpoint: updated.endpoint,
                        enabled: updated.enabled,
                        last_seen_at: updated.last_seen_at.map(|t| t.to_rfc3339()),
                        agent_version: updated.agent_version,
                        last_error: updated.last_error,
                    })
                },
            ),
        );

    let minecraft = Router::new().procedure(
        "versions",
        Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
            let v = crate::minecraft_versions::get_versions()
                .await
                .map_err(|e| {
                    api_error(
                        &ctx,
                        "UPSTREAM_ERROR",
                        format!("minecraft.versions failed: {e}"),
                    )
                })?;
            Ok(v)
        }),
    );

    Router::new()
        .nest("control", control)
        .nest("agent", agent)
        .nest("process", process)
        .nest("minecraft", minecraft)
        .nest("fs", fs)
        .nest("log", log)
        .nest("instance", instance)
        .nest("node", node)
}
