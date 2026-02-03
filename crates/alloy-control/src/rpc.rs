use alloy_proto::agent_v1::{
    ClearCacheRequest, CreateInstanceRequest, DeleteInstancePreviewRequest, DeleteInstanceRequest,
    GetCacheStatsRequest, GetCapabilitiesRequest, GetInstanceRequest, GetStatusRequest,
    HealthCheckRequest, ListDirRequest, ListInstancesRequest, ListProcessesRequest,
    ListTemplatesRequest, ReadFileRequest, StartFromTemplateRequest, StartInstanceRequest,
    StopInstanceRequest, StopProcessRequest, TailFileRequest, TailLogsRequest,
    UpdateInstanceRequest, WarmTemplateCacheRequest,
    agent_health_service_client::AgentHealthServiceClient,
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
    pub field_errors: std::collections::BTreeMap<String, String>,
    pub hint: Option<String>,
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
        field_errors: std::collections::BTreeMap::new(),
        hint: None,
    }
}

fn api_error_with_fields(
    ctx: &Ctx,
    code: &str,
    message: impl Into<String>,
    field_errors: std::collections::BTreeMap<String, String>,
) -> ApiError {
    ApiError {
        code: code.to_string(),
        message: message.into(),
        request_id: ctx.request_id.clone(),
        field_errors,
        hint: None,
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
        return Err(api_error(ctx, "read_only", "control is in read-only mode"));
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
        return Err(api_error(ctx, "rate_limited", "too many requests"));
    }
    Ok(())
}

const AGENT_ERROR_PREFIX: &str = "ALLOY_ERROR_JSON:";

#[derive(Debug, Clone, serde::Deserialize)]
struct AgentErrorPayload {
    code: String,
    message: String,
    field_errors: Option<std::collections::BTreeMap<String, String>>,
    hint: Option<String>,
}

fn parse_agent_error_payload(raw: &str) -> Option<AgentErrorPayload> {
    let payload = raw.trim().strip_prefix(AGENT_ERROR_PREFIX)?;
    serde_json::from_str::<AgentErrorPayload>(payload).ok()
}

fn api_error_from_agent_status(ctx: &Ctx, action: &str, status: tonic::Status) -> ApiError {
    if let Some(payload) = parse_agent_error_payload(status.message()) {
        return ApiError {
            code: payload.code,
            message: payload.message,
            request_id: ctx.request_id.clone(),
            field_errors: payload.field_errors.unwrap_or_default(),
            hint: payload.hint,
        };
    }

    let code = match status.code() {
        tonic::Code::InvalidArgument => "invalid_param",
        tonic::Code::NotFound => "not_found",
        tonic::Code::FailedPrecondition => "failed_precondition",
        tonic::Code::PermissionDenied => "permission_denied",
        tonic::Code::Unauthenticated => "unauthorized",
        tonic::Code::AlreadyExists => "already_exists",
        tonic::Code::ResourceExhausted => "rate_limited",
        tonic::Code::Unavailable => "agent_unreachable",
        tonic::Code::DeadlineExceeded => "timeout",
        _ => "agent_error",
    };

    api_error(ctx, code, format!("{action}: {}", status.message()))
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
pub struct PortAvailabilityDto {
    pub port: u32,
    pub available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct AgentHealthFullDto {
    pub endpoint: String,
    pub ok: bool,
    pub status: Option<String>,
    pub agent_version: Option<String>,
    pub data_root: Option<String>,
    pub data_root_writable: Option<bool>,
    pub data_root_free_bytes: Option<String>,
    pub ports: Option<Vec<PortAvailabilityDto>>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, serde::Serialize, Type)]
pub enum ParamTypeDto {
    String,
    Int,
    Bool,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct TemplateParamDto {
    pub key: String,
    pub label: String,
    pub kind: ParamTypeDto,
    pub required: bool,
    pub default_value: String,
    pub min_int: Option<i32>,
    pub max_int: Option<i32>,
    pub enum_values: Vec<String>,
    pub secret: bool,
    pub placeholder: Option<String>,
    pub help: Option<String>,
    pub advanced: bool,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessTemplateDto {
    pub template_id: String,
    pub display_name: String,
    pub params: Vec<TemplateParamDto>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessResourcesDto {
    pub cpu_percent_x100: u32,
    pub rss_bytes: String,
    pub read_bytes: String,
    pub write_bytes: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessStatusDto {
    pub process_id: String,
    pub template_id: String,
    pub state: String,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
    pub resources: Option<ProcessResourcesDto>,
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
pub struct WarmTemplateCacheInput {
    pub template_id: String,
    pub params: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct WarmTemplateCacheOutput {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct CacheEntryDto {
    pub key: String,
    pub path: String,
    pub size_bytes: String,
    pub last_used_unix_ms: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct CacheStatsOutput {
    pub entries: Vec<CacheEntryDto>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct ClearCacheInput {
    pub keys: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ClearCacheOutput {
    pub ok: bool,
    pub freed_bytes: String,
    pub cleared: Vec<CacheEntryDto>,
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

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct FsCapabilitiesOutput {
    pub write_enabled: bool,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DeleteInstancePreviewOutput {
    pub instance_id: String,
    pub path: String,
    pub size_bytes: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ControlDiagnosticsOutput {
    pub fetched_at_unix_ms: String,
    pub request_id: String,
    pub control_version: String,
    pub read_only: bool,
    pub agent: AgentHealthFullDto,
    pub fs: FsCapabilitiesOutput,
    pub cache: CacheStatsOutput,
    pub agent_log_path: Option<String>,
    pub agent_log_lines: Vec<String>,
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

fn map_param_type(t: i32) -> ParamTypeDto {
    match t {
        x if x == alloy_proto::agent_v1::ParamType::String as i32 => ParamTypeDto::String,
        x if x == alloy_proto::agent_v1::ParamType::Int as i32 => ParamTypeDto::Int,
        x if x == alloy_proto::agent_v1::ParamType::Bool as i32 => ParamTypeDto::Bool,
        _ => ParamTypeDto::String,
    }
}

fn map_template_param(p: alloy_proto::agent_v1::TemplateParam) -> TemplateParamDto {
    let kind = map_param_type(p.r#type);
    TemplateParamDto {
        key: p.key,
        label: p.label,
        kind,
        required: p.required,
        default_value: p.default_value,
        min_int: if matches!(kind, ParamTypeDto::Int) && (p.min_int != 0 || p.max_int != 0) {
            Some(p.min_int.clamp(i32::MIN as i64, i32::MAX as i64) as i32)
        } else {
            None
        },
        max_int: if matches!(kind, ParamTypeDto::Int) && (p.min_int != 0 || p.max_int != 0) {
            Some(p.max_int.clamp(i32::MIN as i64, i32::MAX as i64) as i32)
        } else {
            None
        },
        enum_values: p.enum_values,
        secret: p.secret,
        placeholder: if p.placeholder.trim().is_empty() {
            None
        } else {
            Some(p.placeholder)
        },
        help: if p.help.trim().is_empty() {
            None
        } else {
            Some(p.help)
        },
        advanced: p.advanced,
    }
}

fn map_process_status(p: alloy_proto::agent_v1::ProcessStatus) -> ProcessStatusDto {
    ProcessStatusDto {
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
        resources: p.resources.map(|r| ProcessResourcesDto {
            cpu_percent_x100: r.cpu_percent_x100,
            rss_bytes: r.rss_bytes.to_string(),
            read_bytes: r.read_bytes.to_string(),
            write_bytes: r.write_bytes.to_string(),
        }),
    }
}

fn map_instance_info(
    ctx: &Ctx,
    info: alloy_proto::agent_v1::InstanceInfo,
) -> Result<InstanceInfoDto, ApiError> {
    let cfg = info
        .config
        .ok_or_else(|| api_error(ctx, "internal", "missing instance config"))?;

    Ok(InstanceInfoDto {
        config: map_instance_config(cfg),
        status: info.status.map(map_process_status),
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
    let control = Router::new()
        .procedure(
            "ping",
            Procedure::builder::<ApiError>().query(|_, _: ()| async move {
                Ok(PingResponse {
                    status: "ok".to_string(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                })
            }),
        )
        .procedure(
            "diagnostics",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let fetched_at_unix_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis().to_string())
                    .unwrap_or_else(|_| "0".to_string());

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());

                let mut health_client = AgentHealthServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let mut fs_client = FilesystemServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let mut proc_client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let mut logs_client = LogsServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let health = match health_client
                    .check(Request::new(HealthCheckRequest {}))
                    .await
                {
                    Ok(resp) => {
                        let r = resp.into_inner();
                        AgentHealthFullDto {
                            endpoint: agent_endpoint.clone(),
                            ok: true,
                            status: Some(r.status),
                            agent_version: Some(r.agent_version),
                            data_root: Some(r.data_root),
                            data_root_writable: Some(r.data_root_writable),
                            data_root_free_bytes: Some(r.data_root_free_bytes.to_string()),
                            ports: Some(
                                r.ports
                                    .into_iter()
                                    .map(|p| PortAvailabilityDto {
                                        port: p.port,
                                        available: p.available,
                                        error: if p.error.trim().is_empty() {
                                            None
                                        } else {
                                            Some(p.error)
                                        },
                                    })
                                    .collect(),
                            ),
                            error: None,
                        }
                    }
                    Err(status) => AgentHealthFullDto {
                        endpoint: agent_endpoint.clone(),
                        ok: false,
                        status: None,
                        agent_version: None,
                        data_root: None,
                        data_root_writable: None,
                        data_root_free_bytes: None,
                        ports: None,
                        error: Some(status.message().to_string()),
                    },
                };

                let fs_caps = match fs_client
                    .get_capabilities(Request::new(GetCapabilitiesRequest {}))
                    .await
                {
                    Ok(resp) => FsCapabilitiesOutput {
                        write_enabled: resp.into_inner().write_enabled,
                    },
                    Err(_) => FsCapabilitiesOutput {
                        write_enabled: false,
                    },
                };

                let cache_resp = proc_client
                    .get_cache_stats(Request::new(GetCacheStatsRequest {}))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.get_cache_stats", status)
                    })?
                    .into_inner();

                let cache = CacheStatsOutput {
                    entries: cache_resp
                        .entries
                        .into_iter()
                        .map(|e| CacheEntryDto {
                            key: e.key,
                            path: e.path,
                            size_bytes: e.size_bytes.to_string(),
                            last_used_unix_ms: e.last_used_unix_ms.to_string(),
                        })
                        .collect(),
                };

                let mut agent_log_path: Option<String> = None;
                let mut agent_log_lines: Vec<String> = Vec::new();
                if let Ok(resp) = fs_client
                    .list_dir(Request::new(ListDirRequest {
                        path: "logs".to_string(),
                    }))
                    .await
                {
                    let mut candidates: Vec<String> = resp
                        .into_inner()
                        .entries
                        .into_iter()
                        .filter(|e| !e.is_dir && e.name.starts_with("agent.log"))
                        .map(|e| e.name)
                        .collect();
                    candidates.sort();
                    if let Some(name) = candidates.pop() {
                        let p = format!("logs/{name}");
                        agent_log_path = Some(p.clone());
                        if let Ok(resp) = logs_client
                            .tail_file(Request::new(TailFileRequest {
                                path: p,
                                cursor: String::new(),
                                limit_bytes: 512 * 1024,
                                max_lines: 800,
                            }))
                            .await
                        {
                            agent_log_lines = resp.into_inner().lines;
                        }
                    }
                }

                Ok(ControlDiagnosticsOutput {
                    fetched_at_unix_ms,
                    request_id: ctx.request_id.clone(),
                    control_version: env!("CARGO_PKG_VERSION").to_string(),
                    read_only: is_read_only(),
                    agent: health,
                    fs: fs_caps,
                    cache,
                    agent_log_path,
                    agent_log_lines,
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
                        "agent_unreachable",
                        format!("failed to connect agent ({agent_endpoint}): {e}"),
                    )
                })?;

            let resp = client
                .check(Request::new(HealthCheckRequest {}))
                .await
                .map_err(|status| api_error_from_agent_status(&ctx, "agent.health", status))?;

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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list_templates(Request::new(ListTemplatesRequest {}))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.list_templates", status)
                    })?
                    .into_inner();

                Ok(resp
                    .templates
                    .into_iter()
                    .map(|t| ProcessTemplateDto {
                        template_id: t.template_id,
                        display_name: t.display_name,
                        params: t.params.into_iter().map(map_template_param).collect(),
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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list_processes(Request::new(ListProcessesRequest {}))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.list_processes", status)
                    })?
                    .into_inner();

                Ok(resp
                    .processes
                    .into_iter()
                    .map(map_process_status)
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
                            "agent_unreachable",
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
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.start_from_template", status)
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                let process_id = status.process_id.clone();
                let template_id = status.template_id.clone();
                audit::record(
                    &ctx,
                    "process.start",
                    &process_id,
                    Some(serde_json::json!({ "template_id": template_id })),
                )
                .await;

                Ok(map_process_status(status))
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
                            "agent_unreachable",
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
                    .map_err(|status| api_error_from_agent_status(&ctx, "process.stop", status))?
                    .into_inner()
                    .status
                    .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                let process_id = status.process_id.clone();
                let template_id = status.template_id.clone();
                audit::record(
                    &ctx,
                    "process.stop",
                    &process_id,
                    Some(serde_json::json!({ "template_id": template_id })),
                )
                .await;

                Ok(map_process_status(status))
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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let status = client
                    .get_status(Request::new(GetStatusRequest {
                        process_id: input.process_id,
                    }))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.get_status", status)
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                Ok(map_process_status(status))
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
                            "agent_unreachable",
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
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.tail_logs", status)
                    })?
                    .into_inner();

                Ok(TailLogsOutput {
                    lines: resp.lines,
                    next_cursor: resp.next_cursor,
                })
            }),
        )
        .procedure(
            "warmCache",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: WarmTemplateCacheInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                    let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "agent_unreachable",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;

                    let resp = client
                        .warm_template_cache(Request::new(WarmTemplateCacheRequest {
                            template_id: input.template_id.clone(),
                            params: input.params.clone().into_iter().collect(),
                        }))
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "process.warm_template_cache", status)
                        })?
                        .into_inner();

                    audit::record(
                        &ctx,
                        "process.warmCache",
                        &input.template_id,
                        Some(serde_json::json!({ "params": input.params })),
                    )
                    .await;

                    Ok(WarmTemplateCacheOutput {
                        ok: resp.ok,
                        message: resp.message,
                    })
                },
            ),
        )
        .procedure(
            "cacheStats",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .get_cache_stats(Request::new(GetCacheStatsRequest {}))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.get_cache_stats", status)
                    })?
                    .into_inner();

                Ok(CacheStatsOutput {
                    entries: resp
                        .entries
                        .into_iter()
                        .map(|e| CacheEntryDto {
                            key: e.key,
                            path: e.path,
                            size_bytes: e.size_bytes.to_string(),
                            last_used_unix_ms: e.last_used_unix_ms.to_string(),
                        })
                        .collect(),
                })
            }),
        )
        .procedure(
            "clearCache",
            Procedure::builder::<ApiError>().mutation(|ctx, input: ClearCacheInput| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .clear_cache(Request::new(ClearCacheRequest {
                        keys: input.keys.clone(),
                    }))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.clear_cache", status)
                    })?
                    .into_inner();

                audit::record(
                    &ctx,
                    "process.clearCache",
                    "cache",
                    Some(serde_json::json!({ "keys": input.keys })),
                )
                .await;

                Ok(ClearCacheOutput {
                    ok: resp.ok,
                    freed_bytes: resp.freed_bytes.to_string(),
                    cleared: resp
                        .cleared
                        .into_iter()
                        .map(|e| CacheEntryDto {
                            key: e.key,
                            path: e.path,
                            size_bytes: e.size_bytes.to_string(),
                            last_used_unix_ms: e.last_used_unix_ms.to_string(),
                        })
                        .collect(),
                })
            }),
        );

    let fs = Router::new()
        .procedure(
            "capabilities",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = FilesystemServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .get_capabilities(Request::new(GetCapabilitiesRequest {}))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "fs.get_capabilities", status)
                    })?
                    .into_inner();

                Ok(FsCapabilitiesOutput {
                    write_enabled: resp.write_enabled,
                })
            }),
        )
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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list_dir(Request::new(ListDirRequest {
                        path: input.path.unwrap_or_default(),
                    }))
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "fs.list_dir", status))?
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
                            "agent_unreachable",
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
                    .map_err(|status| api_error_from_agent_status(&ctx, "fs.read_file", status))?
                    .into_inner();

                let text = String::from_utf8(resp.data)
                    .map_err(|_| api_error(&ctx, "invalid_utf8", "file is not valid utf-8"))?;

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
                        "agent_unreachable",
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
                .map_err(|status| api_error_from_agent_status(&ctx, "log.tail_file", status))?
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
                                "agent_unreachable",
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
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.create", status)
                        })?
                        .into_inner();

                    let cfg = resp
                        .config
                        .ok_or_else(|| api_error(&ctx, "internal", "missing instance config"))?;

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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .get(Request::new(GetInstanceRequest {
                        instance_id: input.instance_id,
                    }))
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.get", status))?
                    .into_inner();

                let info = resp
                    .info
                    .ok_or_else(|| api_error(&ctx, "internal", "missing instance info"))?;

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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .list(Request::new(ListInstancesRequest {}))
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.list", status))?
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
                                "agent_unreachable",
                                format!("failed to connect agent ({agent_endpoint}): {e}"),
                            )
                        })?;
                    let mut logs_client = LogsServiceClient::connect(agent_endpoint.clone())
                        .await
                        .map_err(|e| {
                            api_error(
                                &ctx,
                                "agent_unreachable",
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
                            .map_err(|_| api_error(&ctx, "invalid_utf8", "file is not valid utf-8"))
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
                                return Err(api_error_from_agent_status(
                                    &ctx,
                                    "instance.diagnostics.read_file(instance.json)",
                                    status,
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
                                return Err(api_error_from_agent_status(
                                    &ctx,
                                    "instance.diagnostics.read_file(run.json)",
                                    status,
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
                                        return Err(api_error_from_agent_status(
                                            &ctx,
                                            "instance.diagnostics.read_file(run.json)",
                                            status,
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
                                return Err(api_error_from_agent_status(
                                    &ctx,
                                    "instance.diagnostics.tail_file(console.log)",
                                    status,
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
                                        return Err(api_error_from_agent_status(
                                            &ctx,
                                            "instance.diagnostics.tail_file(console.log)",
                                            status,
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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .start(Request::new(StartInstanceRequest {
                        instance_id: input.instance_id,
                    }))
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.start", status))?
                    .into_inner();

                let status = resp
                    .status
                    .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                audit::record(
                    &ctx,
                    "instance.start",
                    &status.process_id,
                    Some(serde_json::json!({ "template_id": status.template_id })),
                )
                .await;

                Ok(map_process_status(status))
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
                                "agent_unreachable",
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
                                return Err(api_error_from_agent_status(
                                    &ctx,
                                    "instance.stop",
                                    status,
                                ));
                            }
                        }
                    }

                    let resp = client
                        .start(Request::new(StartInstanceRequest {
                            instance_id: input.instance_id,
                        }))
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.start", status)
                        })?
                        .into_inner();

                    let status = resp
                        .status
                        .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                    audit::record(
                        &ctx,
                        "instance.restart",
                        &status.process_id,
                        Some(serde_json::json!({ "template_id": status.template_id })),
                    )
                    .await;

                    Ok(map_process_status(status))
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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .stop(Request::new(StopInstanceRequest {
                        instance_id: input.instance_id,
                        timeout_ms: input.timeout_ms.unwrap_or(30_000),
                    }))
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.stop", status))?
                    .into_inner();

                let status = resp
                    .status
                    .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                audit::record(
                    &ctx,
                    "instance.stop",
                    &status.process_id,
                    Some(serde_json::json!({ "template_id": status.template_id })),
                )
                .await;

                Ok(map_process_status(status))
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
                                "agent_unreachable",
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
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.update", status)
                        })?
                        .into_inner();

                    let cfg = resp
                        .config
                        .ok_or_else(|| api_error(&ctx, "internal", "missing instance config"))?;

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
            "deletePreview",
            Procedure::builder::<ApiError>().query(|ctx, input: InstanceIdInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = InstanceServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let resp = client
                    .delete_preview(Request::new(DeleteInstancePreviewRequest {
                        instance_id: input.instance_id,
                    }))
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "instance.delete_preview", status)
                    })?
                    .into_inner();

                Ok(DeleteInstancePreviewOutput {
                    instance_id: resp.instance_id,
                    path: resp.path,
                    size_bytes: resp.size_bytes.to_string(),
                })
            }),
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
                            "agent_unreachable",
                            format!("failed to connect agent ({agent_endpoint}): {e}"),
                        )
                    })?;

                let instance_id = input.instance_id;
                let resp = client
                    .delete(Request::new(DeleteInstanceRequest {
                        instance_id: instance_id.clone(),
                    }))
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.delete", status))?
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
                    .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

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
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    if !user.is_admin {
                        return Err(api_error(&ctx, "forbidden", "forbidden"));
                    }

                    let id = sea_orm::prelude::Uuid::parse_str(&input.node_id)
                        .map_err(|_| api_error(&ctx, "invalid_param", "invalid node_id"))?;

                    let model = nodes::Entity::find_by_id(id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?
                        .ok_or_else(|| api_error(&ctx, "not_found", "node not found"))?;

                    let mut active: nodes::ActiveModel = model.into();
                    active.enabled = Set(input.enabled);
                    let updated = active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

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
                        "upstream_error",
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
