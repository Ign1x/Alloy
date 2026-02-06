use alloy_proto::agent_v1::{
    ClearCacheRequest, CreateInstanceRequest, DeleteInstancePreviewRequest, DeleteInstanceRequest,
    GetCacheStatsRequest, GetCapabilitiesRequest, GetInstanceRequest, GetStatusRequest,
    HealthCheckRequest, ListDirRequest, ListInstancesRequest, ListProcessesRequest,
    ListTemplatesRequest, ReadFileRequest, StartFromTemplateRequest, StartInstanceRequest,
    StopInstanceRequest, StopProcessRequest, TailFileRequest, TailLogsRequest,
    UpdateInstanceRequest, WarmTemplateCacheRequest,
};
use rspc::{Procedure, ProcedureError, ResolverError, Router};

use specta::Type;
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, OnceLock},
    time::{Duration, Instant},
};

use crate::agent_transport::AgentTransport;
use crate::audit;

const SETTING_DST_DEFAULT_KLEI_KEY: &str = "dst.default_klei_key";
const SETTING_CURSEFORGE_API_KEY: &str = "minecraft.curseforge_api_key";
const SETTING_STEAMCMD_USERNAME: &str = "steamcmd.username";
const SETTING_STEAMCMD_PASSWORD: &str = "steamcmd.password";
const SETTING_STEAMCMD_SHARED_SECRET: &str = "steamcmd.shared_secret";
const SETTING_STEAMCMD_ACCOUNT_NAME: &str = "steamcmd.account_name";
const SETTING_DOWNLOAD_QUEUE_PAUSED: &str = "downloads.queue.paused";

const DOWNLOAD_STATE_QUEUED: &str = "queued";
const DOWNLOAD_STATE_RUNNING: &str = "running";
const DOWNLOAD_STATE_PAUSED: &str = "paused";
const DOWNLOAD_STATE_SUCCESS: &str = "success";
const DOWNLOAD_STATE_ERROR: &str = "error";
const DOWNLOAD_STATE_CANCELED: &str = "canceled";

fn random_token(n: usize) -> String {
    use base64::Engine;
    use rand::RngCore;

    let mut buf = vec![0u8; n];
    rand::rngs::OsRng.fill_bytes(&mut buf);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf)
}

fn hash_token(raw: &str) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

#[derive(Debug, Clone, serde::Deserialize)]
struct SteamMaFileRaw {
    account_name: Option<String>,
    shared_secret: Option<String>,
}

fn normalize_steam_guard_code(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

fn parse_steam_mafile_or_secret(raw: &str) -> Result<(Option<String>, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("empty input".to_string());
    }

    let (account_name, shared_secret) = if trimmed.starts_with('{') {
        let parsed = serde_json::from_str::<SteamMaFileRaw>(trimmed)
            .map_err(|e| format!("invalid maFile json: {e}"))?;
        let account_name = parsed
            .account_name
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty());
        let shared_secret = parsed
            .shared_secret
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .ok_or_else(|| "maFile missing shared_secret".to_string())?;
        (account_name, shared_secret)
    } else {
        (None, trimmed.to_string())
    };

    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(shared_secret.as_bytes())
        .map_err(|_| "shared_secret is not valid base64".to_string())?;

    Ok((account_name, shared_secret))
}

fn generate_steam_guard_code(shared_secret_b64: &str, unix_seconds: i64) -> Result<String, String> {
    use base64::Engine;
    use hmac::{Hmac, Mac};
    use sha1::Sha1;

    type HmacSha1 = Hmac<Sha1>;

    let secret = base64::engine::general_purpose::STANDARD
        .decode(shared_secret_b64.as_bytes())
        .map_err(|_| "shared_secret is not valid base64".to_string())?;

    let timestep = (unix_seconds.div_euclid(30)).max(0) as u64;
    let msg = timestep.to_be_bytes();

    let mut mac = HmacSha1::new_from_slice(&secret)
        .map_err(|_| "failed to initialize HMAC with shared_secret".to_string())?;
    mac.update(&msg);
    let digest = mac.finalize().into_bytes();

    let offset = (digest[19] & 0x0f) as usize;
    let mut value = ((u32::from(digest[offset]) & 0x7f) << 24)
        | (u32::from(digest[offset + 1]) << 16)
        | (u32::from(digest[offset + 2]) << 8)
        | u32::from(digest[offset + 3]);

    const STEAM_GUARD_CHARS: &[u8] = b"23456789BCDFGHJKMNPQRTVWXY";
    let mut out = String::with_capacity(5);
    for _ in 0..5 {
        out.push(STEAM_GUARD_CHARS[(value % 26) as usize] as char);
        value /= 26;
    }
    Ok(out)
}

fn generate_steam_guard_candidates(shared_secret_b64: &str) -> Result<Vec<String>, String> {
    let now = chrono::Utc::now().timestamp();
    let mut out = Vec::<String>::new();
    for delta in [0_i64, -30, 30] {
        let code = generate_steam_guard_code(shared_secret_b64, now + delta)?;
        if !out.contains(&code) {
            out.push(code);
        }
    }
    Ok(out)
}

fn normalize_node_name(name: &str) -> Result<String, ()> {
    let n = name.trim();
    if n.is_empty() {
        return Err(());
    }
    if n.len() > 64 {
        return Err(());
    }
    if !n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(());
    }
    Ok(n.to_string())
}

fn normalize_frp_node_name(name: &str) -> Result<String, ()> {
    let n = name.trim();
    if n.is_empty() {
        return Err(());
    }
    if n.len() > 64 {
        return Err(());
    }
    // Allow spaces but keep it simple/safe for UI.
    if !n
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' '))
    {
        return Err(());
    }
    Ok(n.to_string())
}

fn normalize_optional_frp_server_addr(value: &str) -> Result<Option<String>, ()> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(None);
    }
    if v.len() > 255 {
        return Err(());
    }
    if v.chars().any(char::is_whitespace) {
        return Err(());
    }
    Ok(Some(v.to_string()))
}

fn normalize_optional_frp_server_port(value: Option<u16>) -> Option<u16> {
    match value {
        Some(v) if v > 0 => Some(v),
        _ => None,
    }
}

fn normalize_optional_frp_token(value: &str) -> Result<Option<String>, ()> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(None);
    }
    if v.len() > 512 {
        return Err(());
    }
    Ok(Some(v.to_string()))
}

fn normalize_optional_allocatable_ports(value: &str) -> Result<Option<String>, ()> {
    let v = value.trim();
    if v.is_empty() {
        return Ok(None);
    }
    if v.len() > 4096 {
        return Err(());
    }

    let mut expanded = std::collections::BTreeSet::<u16>::new();
    for part in v.split(',') {
        let p = part.trim();
        if p.is_empty() {
            continue;
        }
        if let Some((a_raw, b_raw)) = p.split_once('-') {
            let a = a_raw.trim().parse::<u16>().map_err(|_| ())?;
            let b = b_raw.trim().parse::<u16>().map_err(|_| ())?;
            if a == 0 || b == 0 {
                return Err(());
            }
            let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
            if hi.saturating_sub(lo) > 2000 {
                return Err(());
            }
            for port in lo..=hi {
                expanded.insert(port);
                if expanded.len() > 4000 {
                    return Err(());
                }
            }
        } else {
            let port = p.parse::<u16>().map_err(|_| ())?;
            if port == 0 {
                return Err(());
            }
            expanded.insert(port);
            if expanded.len() > 4000 {
                return Err(());
            }
        }
    }

    if expanded.is_empty() {
        return Ok(None);
    }

    let out = expanded
        .into_iter()
        .map(|p| p.to_string())
        .collect::<Vec<_>>()
        .join(",");
    Ok(Some(out))
}

fn parse_frp_endpoint_from_text(config: &str) -> Option<(String, u16)> {
    let raw = config.trim();
    if raw.is_empty() {
        return None;
    }

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) {
        if let Some(common) = v.get("common") {
            let addr = common
                .get("server_addr")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|x| !x.is_empty())?;
            let port = common
                .get("server_port")
                .and_then(|x| x.as_u64())
                .and_then(|x| u16::try_from(x).ok())?;
            return Some((addr.to_string(), port));
        }
    }

    if let Ok(v) = raw.parse::<toml::Value>() {
        if let Some(common) = v.get("common") {
            let addr = common
                .get("server_addr")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|x| !x.is_empty())?;
            let port = common
                .get("server_port")
                .and_then(|x| x.as_integer())
                .and_then(|x| u16::try_from(x).ok())?;
            return Some((addr.to_string(), port));
        }
    }

    if let Ok(v) = serde_yaml::from_str::<serde_yaml::Value>(raw) {
        if let Some(common) = v.get("common") {
            let addr = common
                .get("server_addr")
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|x| !x.is_empty())?;
            let port = common
                .get("server_port")
                .and_then(|x| x.as_u64())
                .and_then(|x| u16::try_from(x).ok())?;
            return Some((addr.to_string(), port));
        }
    }

    let mut in_common = false;
    let mut server_addr: Option<String> = None;
    let mut server_port: Option<u16> = None;
    for line_raw in raw.lines() {
        let line = line_raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(inner) = line.strip_prefix('[').and_then(|s| s.strip_suffix(']')) {
            in_common = inner.trim().eq_ignore_ascii_case("common");
            continue;
        }
        if !in_common {
            continue;
        }
        let Some((k, v_raw)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim().to_ascii_lowercase();
        let value = v_raw
            .trim()
            .trim_matches('"')
            .trim_matches('\'')
            .split(['#', ';'])
            .next()
            .unwrap_or("")
            .trim();
        if value.is_empty() {
            continue;
        }
        if key == "server_addr" {
            server_addr = Some(value.to_string());
        } else if key == "server_port" {
            if let Ok(port) = value.parse::<u16>() {
                if port > 0 {
                    server_port = Some(port);
                }
            }
        }
    }

    match (server_addr, server_port) {
        (Some(addr), Some(port)) => Some((addr, port)),
        _ => None,
    }
}

fn build_frpc_ini_from_metadata(
    server_addr: &str,
    server_port: u16,
    allocatable_ports: Option<&str>,
    token: Option<&str>,
) -> String {
    let mut lines = vec![
        "[common]".to_string(),
        format!("server_addr = {server_addr}"),
        format!("server_port = {server_port}"),
    ];
    if let Some(v) = token
        && !v.trim().is_empty()
    {
        lines.push(format!("token = {}", v.trim()));
    }
    if let Some(v) = allocatable_ports
        && !v.trim().is_empty()
    {
        lines.push(format!("# alloy_alloc_ports = {}", v.trim()));
    }
    lines.push(String::new());
    lines.push("[alloy]".to_string());
    lines.push("type = tcp".to_string());
    lines.push("local_ip = 127.0.0.1".to_string());
    lines.push("local_port = 0".to_string());
    lines.push("remote_port = 0".to_string());
    lines.join("\n")
}

async fn probe_frp_tcp_latency_ms(server_addr: &str, server_port: u16) -> Option<u32> {
    let target = format!("{server_addr}:{server_port}");
    let start = Instant::now();
    let conn = tokio::time::timeout(
        Duration::from_millis(1200),
        tokio::net::TcpStream::connect(target),
    )
    .await
    .ok()?
    .ok()?;
    drop(conn);
    let ms = start.elapsed().as_millis();
    Some(ms.min(u128::from(u32::MAX)) as u32)
}

struct NormalizedFrpNodePayload {
    name: String,
    server_addr: Option<String>,
    server_port: Option<u16>,
    allocatable_ports: Option<String>,
    token: Option<String>,
    config: String,
}

fn normalize_frp_node_payload(
    ctx: &Ctx,
    name_raw: &str,
    server_addr_raw: Option<&str>,
    server_port_raw: Option<u16>,
    allocatable_ports_raw: Option<&str>,
    token_raw: Option<&str>,
    config_raw: &str,
) -> Result<NormalizedFrpNodePayload, ApiError> {
    let name = normalize_frp_node_name(name_raw).map_err(|_| {
        api_error_with_field(
            ctx,
            "invalid_param",
            "invalid frp node name",
            "name",
            "invalid name",
        )
    })?;

    let mut server_addr = normalize_optional_frp_server_addr(server_addr_raw.unwrap_or_default())
        .map_err(|_| {
        api_error_with_field(
            ctx,
            "invalid_param",
            "invalid frp server",
            "server_addr",
            "invalid host/ip",
        )
    })?;
    let mut server_port = normalize_optional_frp_server_port(server_port_raw);

    let allocatable_ports = normalize_optional_allocatable_ports(
        allocatable_ports_raw.unwrap_or_default(),
    )
    .map_err(|_| {
        api_error_with_field(
            ctx,
            "invalid_param",
            "invalid allocatable ports",
            "allocatable_ports",
            "use commas/ranges like 20000-20100,21000",
        )
    })?;
    let token = normalize_optional_frp_token(token_raw.unwrap_or_default()).map_err(|_| {
        api_error_with_field(
            ctx,
            "invalid_param",
            "invalid frp token",
            "token",
            "token is too long",
        )
    })?;

    let mut config = config_raw.trim().to_string();
    if config.len() > 128 * 1024 {
        return Err(api_error_with_field(
            ctx,
            "invalid_param",
            "invalid frp config",
            "config",
            "config too large (max 128KiB)",
        ));
    }

    if config.is_empty() {
        let addr = server_addr.clone().ok_or_else(|| {
            api_error_with_field(
                ctx,
                "invalid_param",
                "invalid frp server",
                "server_addr",
                "server host/ip is required when config is empty",
            )
        })?;
        let port = server_port.ok_or_else(|| {
            api_error_with_field(
                ctx,
                "invalid_param",
                "invalid frp server",
                "server_port",
                "server port is required when config is empty",
            )
        })?;
        config = build_frpc_ini_from_metadata(
            &addr,
            port,
            allocatable_ports.as_deref(),
            token.as_deref(),
        );
    }

    if server_addr.is_none() || server_port.is_none() {
        if let Some((addr, port)) = parse_frp_endpoint_from_text(&config) {
            if server_addr.is_none() {
                server_addr = Some(addr);
            }
            if server_port.is_none() {
                server_port = Some(port);
            }
        }
    }

    if server_addr.is_none() {
        return Err(api_error_with_field(
            ctx,
            "invalid_param",
            "invalid frp server",
            "server_addr",
            "missing in fields and config",
        ));
    }
    if server_port.is_none() {
        return Err(api_error_with_field(
            ctx,
            "invalid_param",
            "invalid frp server",
            "server_port",
            "missing in fields and config",
        ));
    }

    Ok(NormalizedFrpNodePayload {
        name,
        server_addr,
        server_port,
        allocatable_ports,
        token,
        config,
    })
}

fn api_error_with_field(
    ctx: &Ctx,
    code: &str,
    message: impl Into<String>,
    field: &str,
    field_message: impl Into<String>,
) -> ApiError {
    let mut field_errors = std::collections::BTreeMap::new();
    field_errors.insert(field.to_string(), field_message.into());
    ApiError {
        code: code.to_string(),
        message: message.into(),
        request_id: ctx.request_id.clone(),
        field_errors,
        hint: None,
    }
}

#[derive(Clone, Debug, serde::Serialize, Type)]
pub struct AuthUser {
    pub user_id: String,
    pub username: String,
    pub is_admin: bool,
}

#[derive(Clone)]
struct DownloadQueueRuntime {
    db: Arc<alloy_db::sea_orm::DatabaseConnection>,
    agent_hub: crate::agent_tunnel::AgentHub,
    notify: Arc<tokio::sync::Notify>,
}

static DOWNLOAD_QUEUE_RUNTIME: OnceLock<DownloadQueueRuntime> = OnceLock::new();

pub fn init_download_queue_runtime(
    db: Arc<alloy_db::sea_orm::DatabaseConnection>,
    agent_hub: crate::agent_tunnel::AgentHub,
) {
    let runtime = DownloadQueueRuntime {
        db,
        agent_hub,
        notify: Arc::new(tokio::sync::Notify::new()),
    };

    if DOWNLOAD_QUEUE_RUNTIME.set(runtime.clone()).is_ok() {
        tokio::spawn(download_queue_worker_loop(runtime));
    }
}

fn download_queue_runtime() -> Option<&'static DownloadQueueRuntime> {
    DOWNLOAD_QUEUE_RUNTIME.get()
}

fn wake_download_queue_worker() {
    if let Some(runtime) = download_queue_runtime() {
        runtime.notify.notify_one();
    }
}

// Request context for rspc procedures.
#[derive(Clone)]
pub struct Ctx {
    pub db: Arc<alloy_db::sea_orm::DatabaseConnection>,
    pub agent_hub: crate::agent_tunnel::AgentHub,
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
        //
        // NOTE: rspc-axum's legacy JSON-RPC executor currently discards the resolver value and only
        // forwards a string message. Use `LegacyErrorInterop` to preserve a structured error for the
        // frontend while still remaining compatible with future non-legacy executors.
        let msg = serde_json::to_string(&self)
            .map(|json| format!("ALLOY_API_ERROR_JSON:{json}"))
            .unwrap_or_else(|_| format!("ALLOY_API_ERROR:{}", self.message));
        ResolverError::new(self, Some(rspc_procedure::LegacyErrorInterop(msg))).into()
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

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DownloadQueueJobDto {
    pub id: String,
    pub target: String,
    pub template_id: String,
    pub version: String,
    pub params: std::collections::BTreeMap<String, String>,
    pub state: String,
    pub message: String,
    pub request_id: Option<String>,
    pub queue_position: String,
    pub attempt_count: i32,
    pub created_at_unix_ms: String,
    pub started_at_unix_ms: Option<String>,
    pub updated_at_unix_ms: String,
    pub finished_at_unix_ms: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DownloadQueueOutput {
    pub queue_paused: bool,
    pub jobs: Vec<DownloadQueueJobDto>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct DownloadQueueEnqueueInput {
    pub target: String,
    pub template_id: String,
    pub version: String,
    pub params: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct DownloadQueueSetPausedInput {
    pub paused: bool,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct DownloadQueueMoveInput {
    pub job_id: String,
    pub direction: i32,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct DownloadQueueJobActionInput {
    pub job_id: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DownloadQueueMutationOutput {
    pub ok: bool,
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
    pub modified_unix_ms: String,
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
    pub has_connect_token: bool,
    pub enabled: bool,
    pub last_seen_at: Option<String>,
    pub agent_version: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct FrpNodeDto {
    pub id: String,
    pub name: String,
    pub server_addr: Option<String>,
    pub server_port: Option<u16>,
    pub allocatable_ports: Option<String>,
    pub token: Option<String>,
    pub config: String,
    pub latency_ms: Option<u32>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct FrpNodeCreateInput {
    pub name: String,
    pub server_addr: Option<String>,
    pub server_port: Option<u16>,
    pub allocatable_ports: Option<String>,
    pub token: Option<String>,
    pub config: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct FrpNodeUpdateInput {
    pub id: String,
    pub name: String,
    pub server_addr: Option<String>,
    pub server_port: Option<u16>,
    pub allocatable_ports: Option<String>,
    pub token: Option<String>,
    pub config: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct FrpNodeDeleteInput {
    pub id: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct FrpNodeDeleteOutput {
    pub ok: bool,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct NodeCreateInput {
    pub name: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct NodeCreateOutput {
    pub node: NodeDto,
    pub connect_token: String,
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
pub struct SettingsStatusOutput {
    pub dst_default_klei_key_set: bool,
    pub curseforge_api_key_set: bool,
    pub steamcmd_username_set: bool,
    pub steamcmd_password_set: bool,
    pub steamcmd_shared_secret_set: bool,
    pub steamcmd_account_name: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct SetDstDefaultKleiKeyInput {
    pub key: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct SetCurseforgeApiKeyInput {
    pub key: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct SetSteamcmdCredentialsInput {
    pub username: String,
    pub password: String,
    pub steam_guard_code: Option<String>,
    pub shared_secret: Option<String>,
    pub mafile_json: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct UpdateLatestReleaseDto {
    pub tag: String,
    pub version: Option<String>,
    pub url: String,
    pub published_at: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct UpdateCheckOutput {
    pub current_version: String,
    pub latest: Option<UpdateLatestReleaseDto>,
    pub update_available: bool,
    pub can_trigger_update: bool,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct UpdateTriggerOutput {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct ImportSaveFromUrlInput {
    pub instance_id: String,
    pub url: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ImportSaveFromUrlOutput {
    pub ok: bool,
    pub message: String,
    pub installed_path: String,
    pub backup_path: String,
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

fn agent_transport(ctx: &Ctx) -> AgentTransport {
    AgentTransport::new(ctx.agent_hub.clone())
}

async fn verify_steamcmd_login_via_agent(
    ctx: &Ctx,
    username: &str,
    password: &str,
    steam_guard_code: Option<&str>,
) -> Result<(), ApiError> {
    let transport = agent_transport(ctx);

    let mut verify_params = std::collections::BTreeMap::<String, String>::new();
    verify_params.insert("steam_username".to_string(), username.to_string());
    verify_params.insert("steam_password".to_string(), password.to_string());
    if let Some(code) = steam_guard_code
        && !code.trim().is_empty()
    {
        verify_params.insert("steam_guard_code".to_string(), code.trim().to_string());
    }

    let _verified: alloy_proto::agent_v1::WarmTemplateCacheResponse = transport
        .call(
            "/alloy.agent.v1.ProcessService/WarmTemplateCache",
            WarmTemplateCacheRequest {
                template_id: "steamcmd:auth".to_string(),
                params: verify_params.into_iter().collect(),
            },
        )
        .await
        .map_err(|status| {
            api_error_from_agent_status(ctx, "settings.setSteamcmdCredentials.verify", status)
        })?;

    Ok(())
}

async fn setting_get(
    db: &alloy_db::sea_orm::DatabaseConnection,
    key: &str,
) -> Result<Option<String>, sea_orm::DbErr> {
    use alloy_db::entities::settings;
    use sea_orm::EntityTrait;
    Ok(settings::Entity::find_by_id(key.to_string())
        .one(db)
        .await?
        .map(|m| m.value))
}

async fn setting_is_set(
    db: &alloy_db::sea_orm::DatabaseConnection,
    key: &str,
) -> Result<bool, sea_orm::DbErr> {
    Ok(setting_get(db, key)
        .await?
        .is_some_and(|v| !v.trim().is_empty()))
}

async fn setting_set(
    db: &alloy_db::sea_orm::DatabaseConnection,
    key: &str,
    value: &str,
    is_secret: bool,
) -> Result<(), sea_orm::DbErr> {
    use alloy_db::entities::settings;
    use sea_orm::{EntityTrait, Set};

    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
    let model = settings::ActiveModel {
        key: Set(key.to_string()),
        value: Set(value.to_string()),
        is_secret: Set(is_secret),
        created_at: Set(now),
        updated_at: Set(now),
    };

    settings::Entity::insert(model)
        .on_conflict(
            sea_orm::sea_query::OnConflict::column(settings::Column::Key)
                .update_columns([
                    settings::Column::Value,
                    settings::Column::IsSecret,
                    settings::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(db)
        .await?;
    Ok(())
}

async fn setting_set_secret(
    db: &alloy_db::sea_orm::DatabaseConnection,
    key: &str,
    value: &str,
) -> Result<(), sea_orm::DbErr> {
    setting_set(db, key, value, true).await
}

async fn setting_clear(
    db: &alloy_db::sea_orm::DatabaseConnection,
    key: &str,
) -> Result<(), sea_orm::DbErr> {
    use alloy_db::entities::settings;
    use sea_orm::EntityTrait;
    let _ = settings::Entity::delete_by_id(key.to_string())
        .exec(db)
        .await?;
    Ok(())
}

fn normalize_download_target(raw: &str) -> Option<&'static str> {
    match raw.trim() {
        "minecraft_vanilla" => Some("minecraft_vanilla"),
        "terraria_vanilla" => Some("terraria_vanilla"),
        "dsp_nebula" => Some("dsp_nebula"),
        _ => None,
    }
}

fn expected_template_id_for_target(target: &str) -> Option<&'static str> {
    match target {
        "minecraft_vanilla" => Some("minecraft:vanilla"),
        "terraria_vanilla" => Some("terraria:vanilla"),
        "dsp_nebula" => Some("dsp:nebula"),
        _ => None,
    }
}

fn normalize_download_template_id(raw: &str) -> Option<&'static str> {
    match raw.trim() {
        "minecraft:vanilla" => Some("minecraft:vanilla"),
        "terraria:vanilla" => Some("terraria:vanilla"),
        "dsp:nebula" => Some("dsp:nebula"),
        _ => None,
    }
}

fn download_state_rank(state: &str) -> i32 {
    match state {
        DOWNLOAD_STATE_RUNNING => 0,
        DOWNLOAD_STATE_QUEUED => 1,
        DOWNLOAD_STATE_PAUSED => 2,
        DOWNLOAD_STATE_ERROR => 3,
        DOWNLOAD_STATE_SUCCESS => 4,
        DOWNLOAD_STATE_CANCELED => 5,
        _ => 9,
    }
}

fn normalize_download_version(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        "latest".to_string()
    } else {
        trimmed.chars().take(128).collect()
    }
}

fn parse_download_job_params(raw: &str) -> std::collections::BTreeMap<String, String> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return std::collections::BTreeMap::new();
    };

    let mut out = std::collections::BTreeMap::<String, String>::new();
    let serde_json::Value::Object(map) = value else {
        return out;
    };

    for (k, v) in map {
        let key = k.trim();
        if key.is_empty() || key.len() > 120 {
            continue;
        }
        let value = match v {
            serde_json::Value::Null => continue,
            serde_json::Value::String(s) => s,
            other => other.to_string(),
        };
        if value.len() > 8192 {
            continue;
        }
        out.insert(key.to_string(), value);
    }

    out
}

fn serialize_download_job_params(
    params: &std::collections::BTreeMap<String, String>,
) -> Result<String, String> {
    let mut filtered = std::collections::BTreeMap::<String, String>::new();
    for (k, v) in params {
        let key = k.trim();
        if key.is_empty() || key.len() > 120 {
            continue;
        }
        filtered.insert(key.to_string(), v.chars().take(8192).collect());
    }
    serde_json::to_string(&filtered).map_err(|e| format!("invalid params json: {e}"))
}

fn dt_to_unix_ms(dt: chrono::DateTime<chrono::FixedOffset>) -> String {
    dt.timestamp_millis().to_string()
}

fn map_download_job_model(model: alloy_db::entities::download_jobs::Model) -> DownloadQueueJobDto {
    DownloadQueueJobDto {
        id: model.id.to_string(),
        target: model.target,
        template_id: model.template_id,
        version: model.version,
        params: parse_download_job_params(&model.params_json),
        state: model.state,
        message: model.message,
        request_id: model.request_id,
        queue_position: model.queue_position.to_string(),
        attempt_count: model.attempt_count,
        created_at_unix_ms: dt_to_unix_ms(model.created_at),
        started_at_unix_ms: model.started_at.map(dt_to_unix_ms),
        updated_at_unix_ms: dt_to_unix_ms(model.updated_at),
        finished_at_unix_ms: model.finished_at.map(dt_to_unix_ms),
    }
}

async fn download_queue_is_paused(
    db: &alloy_db::sea_orm::DatabaseConnection,
) -> Result<bool, sea_orm::DbErr> {
    Ok(setting_get(db, SETTING_DOWNLOAD_QUEUE_PAUSED)
        .await?
        .is_some_and(|v| matches!(v.trim(), "1" | "true" | "yes" | "on")))
}

async fn download_queue_set_paused(
    db: &alloy_db::sea_orm::DatabaseConnection,
    paused: bool,
) -> Result<(), sea_orm::DbErr> {
    if paused {
        setting_set(db, SETTING_DOWNLOAD_QUEUE_PAUSED, "1", false).await
    } else {
        setting_clear(db, SETTING_DOWNLOAD_QUEUE_PAUSED).await
    }
}

async fn download_queue_snapshot(
    db: &alloy_db::sea_orm::DatabaseConnection,
) -> Result<DownloadQueueOutput, sea_orm::DbErr> {
    use alloy_db::entities::download_jobs;
    use sea_orm::{EntityTrait, QueryOrder};

    let queue_paused = download_queue_is_paused(db).await?;
    let mut rows = download_jobs::Entity::find()
        .order_by_desc(download_jobs::Column::UpdatedAt)
        .all(db)
        .await?;

    rows.sort_by(|a, b| {
        let ar = download_state_rank(&a.state);
        let br = download_state_rank(&b.state);
        if ar != br {
            return ar.cmp(&br);
        }
        if ar <= 2 {
            if a.queue_position != b.queue_position {
                return a.queue_position.cmp(&b.queue_position);
            }
            return a.created_at.cmp(&b.created_at);
        }
        b.updated_at.cmp(&a.updated_at)
    });
    if rows.len() > 80 {
        rows.truncate(80);
    }

    Ok(DownloadQueueOutput {
        queue_paused,
        jobs: rows.into_iter().map(map_download_job_model).collect(),
    })
}

async fn download_queue_next_position(
    db: &alloy_db::sea_orm::DatabaseConnection,
) -> Result<i64, sea_orm::DbErr> {
    use alloy_db::entities::download_jobs;
    use sea_orm::{EntityTrait, QueryOrder};

    let top = download_jobs::Entity::find()
        .order_by_desc(download_jobs::Column::QueuePosition)
        .one(db)
        .await?;
    Ok(top.map(|m| m.queue_position.saturating_add(1)).unwrap_or(1))
}

async fn trim_download_history(
    db: &alloy_db::sea_orm::DatabaseConnection,
    keep_terminal: usize,
) -> Result<(), sea_orm::DbErr> {
    use alloy_db::entities::download_jobs;
    use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter, QueryOrder};

    let terminal_condition = Condition::any()
        .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_SUCCESS))
        .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_ERROR))
        .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_CANCELED));

    let terminal_rows = download_jobs::Entity::find()
        .filter(terminal_condition)
        .order_by_desc(download_jobs::Column::UpdatedAt)
        .all(db)
        .await?;

    if terminal_rows.len() <= keep_terminal {
        return Ok(());
    }

    let stale_ids: Vec<sea_orm::prelude::Uuid> = terminal_rows
        .into_iter()
        .skip(keep_terminal)
        .map(|m| m.id)
        .collect();

    if stale_ids.is_empty() {
        return Ok(());
    }

    let _ = download_jobs::Entity::delete_many()
        .filter(download_jobs::Column::Id.is_in(stale_ids))
        .exec(db)
        .await?;
    Ok(())
}

async fn recover_download_queue_after_restart(
    db: &alloy_db::sea_orm::DatabaseConnection,
) -> Result<(), sea_orm::DbErr> {
    use alloy_db::entities::download_jobs;
    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

    let rows = download_jobs::Entity::find()
        .filter(download_jobs::Column::State.eq(DOWNLOAD_STATE_RUNNING))
        .all(db)
        .await?;

    if rows.is_empty() {
        return Ok(());
    }

    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
    let next_base = download_queue_next_position(db).await?;

    for (idx, row) in rows.into_iter().enumerate() {
        let mut active: download_jobs::ActiveModel = row.into();
        active.state = Set(DOWNLOAD_STATE_QUEUED.to_string());
        active.message = Set("queued after control restart".to_string());
        active.request_id = Set(None);
        active.finished_at = Set(None);
        active.updated_at = Set(now);
        active.queue_position = Set(next_base.saturating_add(idx as i64));
        let _ = active.update(db).await?;
    }

    Ok(())
}

fn compact_download_error_message(raw: &str) -> String {
    let normalized = raw.trim().replace("\r", "");
    let mut lines = normalized.lines().map(str::trim).filter(|l| !l.is_empty());
    let mut out = Vec::<String>::new();
    for _ in 0..10 {
        let Some(line) = lines.next() else {
            break;
        };
        out.push(line.chars().take(240).collect());
    }
    if out.is_empty() {
        return "download failed".to_string();
    }
    let mut text = out.join(" · ");
    if text.len() > 1200 {
        text.truncate(1200);
        text.push('…');
    }
    text
}

async fn prepare_warm_params(
    db: &alloy_db::sea_orm::DatabaseConnection,
    template_id: &str,
    mut params: std::collections::BTreeMap<String, String>,
) -> Result<std::collections::BTreeMap<String, String>, String> {
    if template_id != "dsp:nebula" {
        return Ok(params);
    }

    let current_user = params.get("steam_username").map(|s| s.trim()).unwrap_or("");
    if current_user.is_empty()
        && let Some(v) = setting_get(db, SETTING_STEAMCMD_USERNAME)
            .await
            .map_err(|e| format!("db error: {e}"))?
    {
        let v = v.trim().to_string();
        if !v.is_empty() {
            params.insert("steam_username".to_string(), v);
        }
    }

    let current_pass = params.get("steam_password").map(|s| s.trim()).unwrap_or("");
    if current_pass.is_empty()
        && let Some(v) = setting_get(db, SETTING_STEAMCMD_PASSWORD)
            .await
            .map_err(|e| format!("db error: {e}"))?
    {
        if !v.trim().is_empty() {
            params.insert("steam_password".to_string(), v);
        }
    }

    let current_guard = params
        .get("steam_guard_code")
        .map(|s| s.trim())
        .unwrap_or("");
    if current_guard.is_empty()
        && let Some(secret) = setting_get(db, SETTING_STEAMCMD_SHARED_SECRET)
            .await
            .map_err(|e| format!("db error: {e}"))?
    {
        let secret = secret.trim().to_string();
        if !secret.is_empty() {
            let candidates = generate_steam_guard_candidates(&secret)
                .map_err(|e| format!("stored Steam shared_secret is invalid: {e}"))?;
            if let Some(code) = candidates.first() {
                params.insert("steam_guard_code".to_string(), code.clone());
            }
        }
    }

    Ok(params)
}

async fn download_queue_worker_loop(runtime: DownloadQueueRuntime) {
    if let Err(e) = recover_download_queue_after_restart(&runtime.db).await {
        tracing::error!(error = %e, "download queue recovery failed");
    }

    loop {
        let did_work = match run_next_download_queue_job(&runtime).await {
            Ok(v) => v,
            Err(e) => {
                tracing::error!(error = %e, "download queue worker tick failed");
                false
            }
        };

        if did_work {
            continue;
        }

        runtime.notify.notified().await;
    }
}

async fn run_next_download_queue_job(runtime: &DownloadQueueRuntime) -> Result<bool, String> {
    use alloy_db::entities::download_jobs;
    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, QueryOrder, Set};

    if download_queue_is_paused(&runtime.db)
        .await
        .map_err(|e| format!("db error: {e}"))?
    {
        return Ok(false);
    }

    let Some(row) = download_jobs::Entity::find()
        .filter(download_jobs::Column::State.eq(DOWNLOAD_STATE_QUEUED))
        .order_by_asc(download_jobs::Column::QueuePosition)
        .order_by_asc(download_jobs::Column::CreatedAt)
        .one(&*runtime.db)
        .await
        .map_err(|e| format!("db error: {e}"))?
    else {
        return Ok(false);
    };

    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
    let mut running: download_jobs::ActiveModel = row.clone().into();
    running.state = Set(DOWNLOAD_STATE_RUNNING.to_string());
    running.message = Set("starting download…".to_string());
    running.request_id = Set(None);
    running.started_at = Set(Some(now));
    running.finished_at = Set(None);
    running.updated_at = Set(now);
    running.attempt_count = Set(row.attempt_count.saturating_add(1));
    let running = running
        .update(&*runtime.db)
        .await
        .map_err(|e| format!("db error: {e}"))?;

    let mut params = parse_download_job_params(&running.params_json);
    params = prepare_warm_params(&runtime.db, &running.template_id, params).await?;

    let transport = AgentTransport::new(runtime.agent_hub.clone());
    match transport
        .call::<_, alloy_proto::agent_v1::WarmTemplateCacheResponse>(
            "/alloy.agent.v1.ProcessService/WarmTemplateCache",
            WarmTemplateCacheRequest {
                template_id: running.template_id.clone(),
                params: params.into_iter().collect(),
            },
        )
        .await
    {
        Ok(resp) => {
            let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
            let mut done: download_jobs::ActiveModel = running.into();
            done.state = Set(DOWNLOAD_STATE_SUCCESS.to_string());
            done.message = Set(resp.message);
            done.request_id = Set(None);
            done.updated_at = Set(now);
            done.finished_at = Set(Some(now));
            let _ = done
                .update(&*runtime.db)
                .await
                .map_err(|e| format!("db error: {e}"))?;
            let _ = trim_download_history(&runtime.db, 50).await;
            Ok(true)
        }
        Err(status) => {
            let msg = if let Some(payload) = parse_agent_error_payload(status.message()) {
                payload.message
            } else {
                format!("process.warm_template_cache: {}", status.message())
            };
            let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
            let mut failed: download_jobs::ActiveModel = running.into();
            failed.state = Set(DOWNLOAD_STATE_ERROR.to_string());
            failed.message = Set(compact_download_error_message(&msg));
            failed.request_id = Set(None);
            failed.updated_at = Set(now);
            failed.finished_at = Set(Some(now));
            let _ = failed
                .update(&*runtime.db)
                .await
                .map_err(|e| format!("db error: {e}"))?;
            let _ = trim_download_history(&runtime.db, 50).await;
            Ok(true)
        }
    }
}

async fn settings_status_output(ctx: &Ctx) -> Result<SettingsStatusOutput, ApiError> {
    let dst_set = setting_is_set(&*ctx.db, SETTING_DST_DEFAULT_KLEI_KEY)
        .await
        .map_err(|e| api_error(ctx, "db_error", format!("db error: {e}")))?;
    let cf_set = setting_is_set(&*ctx.db, SETTING_CURSEFORGE_API_KEY)
        .await
        .map_err(|e| api_error(ctx, "db_error", format!("db error: {e}")))?;
    let steam_user_set = setting_is_set(&*ctx.db, SETTING_STEAMCMD_USERNAME)
        .await
        .map_err(|e| api_error(ctx, "db_error", format!("db error: {e}")))?;
    let steam_pass_set = setting_is_set(&*ctx.db, SETTING_STEAMCMD_PASSWORD)
        .await
        .map_err(|e| api_error(ctx, "db_error", format!("db error: {e}")))?;
    let steam_shared_secret_set = setting_is_set(&*ctx.db, SETTING_STEAMCMD_SHARED_SECRET)
        .await
        .map_err(|e| api_error(ctx, "db_error", format!("db error: {e}")))?;
    let steam_account_name = setting_get(&*ctx.db, SETTING_STEAMCMD_ACCOUNT_NAME)
        .await
        .map_err(|e| api_error(ctx, "db_error", format!("db error: {e}")))?
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    Ok(SettingsStatusOutput {
        dst_default_klei_key_set: dst_set,
        curseforge_api_key_set: cf_set,
        steamcmd_username_set: steam_user_set,
        steamcmd_password_set: steam_pass_set,
        steamcmd_shared_secret_set: steam_shared_secret_set,
        steamcmd_account_name: steam_account_name,
    })
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
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                let fetched_at_unix_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis().to_string())
                    .unwrap_or_else(|_| "0".to_string());

                let transport = agent_transport(&ctx);
                let connected_nodes = transport.connected_nodes().await;
                let agent_endpoint = if connected_nodes.is_empty() {
                    std::env::var("ALLOY_AGENT_ENDPOINT")
                        .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string())
                } else if connected_nodes.len() == 1 {
                    format!("tunnel://{}", connected_nodes[0])
                } else {
                    format!("tunnel://{} nodes", connected_nodes.len())
                };

                let health = match transport
                    .call::<_, alloy_proto::agent_v1::HealthCheckResponse>(
                        "/alloy.agent.v1.AgentHealthService/Check",
                        HealthCheckRequest {},
                    )
                    .await
                {
                    Ok(r) => AgentHealthFullDto {
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
                    },
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

                let fs_caps = match transport
                    .call::<_, alloy_proto::agent_v1::GetCapabilitiesResponse>(
                        "/alloy.agent.v1.FilesystemService/GetCapabilities",
                        GetCapabilitiesRequest {},
                    )
                    .await
                {
                    Ok(resp) => FsCapabilitiesOutput {
                        write_enabled: resp.write_enabled,
                    },
                    Err(_) => FsCapabilitiesOutput {
                        write_enabled: false,
                    },
                };

                let cache_resp: alloy_proto::agent_v1::GetCacheStatsResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/GetCacheStats",
                        GetCacheStatsRequest {},
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.get_cache_stats", status)
                    })?;

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
                if let Ok(resp) = transport
                    .call::<_, alloy_proto::agent_v1::ListDirResponse>(
                        "/alloy.agent.v1.FilesystemService/ListDir",
                        ListDirRequest {
                            path: "logs".to_string(),
                        },
                    )
                    .await
                {
                    let mut candidates: Vec<String> = resp
                        .entries
                        .into_iter()
                        .filter(|e| !e.is_dir && e.name.starts_with("agent.log"))
                        .map(|e| e.name)
                        .collect();
                    candidates.sort();
                    if let Some(name) = candidates.pop() {
                        let p = format!("logs/{name}");
                        agent_log_path = Some(p.clone());
                        if let Ok(resp) = transport
                            .call::<_, alloy_proto::agent_v1::TailFileResponse>(
                                "/alloy.agent.v1.LogsService/TailFile",
                                TailFileRequest {
                                    path: p,
                                    cursor: String::new(),
                                    limit_bytes: 512 * 1024,
                                    max_lines: 800,
                                },
                            )
                            .await
                        {
                            agent_log_lines = resp.lines;
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
            let transport = agent_transport(&ctx);
            let resp: alloy_proto::agent_v1::HealthCheckResponse = transport
                .call(
                    "/alloy.agent.v1.AgentHealthService/Check",
                    HealthCheckRequest {},
                )
                .await
                .map_err(|status| api_error_from_agent_status(&ctx, "agent.health", status))?;

            Ok(AgentHealthResponse {
                status: resp.status,
                agent_version: resp.agent_version,
            })
        }),
    );

    let process = Router::new()
        .procedure(
            "templates",
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::ListTemplatesResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/ListTemplates",
                        ListTemplatesRequest {},
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.list_templates", status)
                    })?;

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
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::ListProcessesResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/ListProcesses",
                        ListProcessesRequest {},
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.list_processes", status)
                    })?;

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

                let transport = agent_transport(&ctx);

                let req = StartFromTemplateRequest {
                    template_id: input.template_id,
                    params: input.params.into_iter().collect(),
                };

                let resp: alloy_proto::agent_v1::StartFromTemplateResponse = transport
                    .call("/alloy.agent.v1.ProcessService/StartFromTemplate", req)
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.start_from_template", status)
                    })?;

                let status = resp
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

                let transport = agent_transport(&ctx);

                let req = StopProcessRequest {
                    process_id: input.process_id,
                    timeout_ms: input.timeout_ms.unwrap_or(30_000),
                };

                let resp: alloy_proto::agent_v1::StopProcessResponse = transport
                    .call("/alloy.agent.v1.ProcessService/Stop", req)
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "process.stop", status))?;

                let status = resp
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
                let transport = agent_transport(&ctx);

                let resp: alloy_proto::agent_v1::GetStatusResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/GetStatus",
                        GetStatusRequest {
                            process_id: input.process_id,
                        },
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.get_status", status)
                    })?;

                let status = resp
                    .status
                    .ok_or_else(|| api_error(&ctx, "internal", "missing status"))?;

                Ok(map_process_status(status))
            }),
        )
        .procedure(
            "logsTail",
            Procedure::builder::<ApiError>().query(|ctx, input: TailLogsInput| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::TailLogsResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/TailLogs",
                        TailLogsRequest {
                            process_id: input.process_id,
                            limit: input.limit.unwrap_or(200),
                            cursor: input.cursor.unwrap_or_default(),
                        },
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.tail_logs", status)
                    })?;

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

                    let transport = agent_transport(&ctx);

                    let template_id = input.template_id.clone();
                    let params = prepare_warm_params(&*ctx.db, &template_id, input.params.clone())
                        .await
                        .map_err(|e| {
                            let lower = e.to_ascii_lowercase();
                            if lower.contains("shared_secret") {
                                api_error_with_field(
                                    &ctx,
                                    "invalid_param",
                                    e,
                                    "steam_guard_code",
                                    "Re-import maFile/shared_secret in Settings.",
                                )
                            } else if lower.contains("db error") {
                                api_error(&ctx, "db_error", e)
                            } else {
                                api_error(&ctx, "invalid_param", e)
                            }
                        })?;

                    let resp: alloy_proto::agent_v1::WarmTemplateCacheResponse = transport
                        .call(
                            "/alloy.agent.v1.ProcessService/WarmTemplateCache",
                            WarmTemplateCacheRequest {
                                template_id: template_id.clone(),
                                params: params.clone().into_iter().collect(),
                            },
                        )
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "process.warm_template_cache", status)
                        })?;

                    let mut audit_params = serde_json::Map::new();
                    for (key, value) in &params {
                        let key_lower = key.to_ascii_lowercase();
                        let is_secret = key_lower.contains("password")
                            || key_lower.contains("token")
                            || key_lower.contains("secret")
                            || key_lower.contains("api_key")
                            || key_lower.contains("apikey");
                        audit_params.insert(
                            key.clone(),
                            serde_json::Value::String(if is_secret {
                                "<redacted>".to_string()
                            } else {
                                value.clone()
                            }),
                        );
                    }

                    audit::record(
                        &ctx,
                        "process.warmCache",
                        &template_id,
                        Some(serde_json::json!({ "params": audit_params })),
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
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::GetCacheStatsResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/GetCacheStats",
                        GetCacheStatsRequest {},
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.get_cache_stats", status)
                    })?;

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

                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::ClearCacheResponse = transport
                    .call(
                        "/alloy.agent.v1.ProcessService/ClearCache",
                        ClearCacheRequest {
                            keys: input.keys.clone(),
                        },
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "process.clear_cache", status)
                    })?;

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
        )
        .procedure(
            "downloadQueue",
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                download_queue_snapshot(&*ctx.db)
                    .await
                    .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))
            }),
        )
        .procedure(
            "downloadQueueEnqueue",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueEnqueueInput| async move {
                    use alloy_db::entities::download_jobs;
                    use sea_orm::{ActiveModelTrait, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let target = normalize_download_target(&input.target).ok_or_else(|| {
                        api_error_with_field(
                            &ctx,
                            "invalid_param",
                            "invalid target",
                            "target",
                            "unsupported target",
                        )
                    })?;
                    let template_id = normalize_download_template_id(&input.template_id)
                        .ok_or_else(|| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                "invalid template_id",
                                "template_id",
                                "unsupported template",
                            )
                        })?;
                    if expected_template_id_for_target(target) != Some(template_id) {
                        return Err(api_error_with_field(
                            &ctx,
                            "invalid_param",
                            "template does not match target",
                            "template_id",
                            "target/template mismatch",
                        ));
                    }

                    if input.params.len() > 64 {
                        return Err(api_error_with_field(
                            &ctx,
                            "invalid_param",
                            "too many params",
                            "params",
                            "at most 64 params",
                        ));
                    }

                    let params_json =
                        serialize_download_job_params(&input.params).map_err(|e| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                e,
                                "params",
                                "invalid params",
                            )
                        })?;

                    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
                    let queue_position = download_queue_next_position(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    let model = download_jobs::ActiveModel {
                        id: Set(sea_orm::prelude::Uuid::new_v4()),
                        target: Set(target.to_string()),
                        template_id: Set(template_id.to_string()),
                        version: Set(normalize_download_version(&input.version)),
                        params_json: Set(params_json),
                        state: Set(DOWNLOAD_STATE_QUEUED.to_string()),
                        message: Set("queued for download".to_string()),
                        request_id: Set(None),
                        queue_position: Set(queue_position),
                        attempt_count: Set(0),
                        created_at: Set(now),
                        updated_at: Set(now),
                        started_at: Set(None),
                        finished_at: Set(None),
                    };

                    let inserted = model
                        .insert(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    let _ = trim_download_history(&*ctx.db, 50).await;
                    wake_download_queue_worker();

                    audit::record(
                        &ctx,
                        "process.downloadQueueEnqueue",
                        &inserted.id.to_string(),
                        Some(serde_json::json!({
                            "target": target,
                            "template_id": template_id,
                            "version": inserted.version,
                        })),
                    )
                    .await;

                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueueSetPaused",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueSetPausedInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    download_queue_set_paused(&*ctx.db, input.paused)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    wake_download_queue_worker();

                    audit::record(
                        &ctx,
                        "process.downloadQueueSetPaused",
                        if input.paused { "paused" } else { "running" },
                        None,
                    )
                    .await;

                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueueMove",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueMoveInput| async move {
                    use alloy_db::entities::download_jobs;
                    use sea_orm::{
                        ActiveModelTrait, ColumnTrait, Condition, EntityTrait, QueryFilter,
                        QueryOrder, Set,
                    };

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let job_id =
                        sea_orm::prelude::Uuid::parse_str(input.job_id.trim()).map_err(|_| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                "invalid job id",
                                "job_id",
                                "invalid uuid",
                            )
                        })?;
                    let direction = if input.direction < 0 {
                        -1_i32
                    } else if input.direction > 0 {
                        1_i32
                    } else {
                        0_i32
                    };
                    if direction == 0 {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    }

                    let queue_condition = Condition::any()
                        .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_QUEUED))
                        .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_PAUSED));

                    let rows = download_jobs::Entity::find()
                        .filter(queue_condition)
                        .order_by_asc(download_jobs::Column::QueuePosition)
                        .order_by_asc(download_jobs::Column::CreatedAt)
                        .all(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    let Some(idx) = rows.iter().position(|r| r.id == job_id) else {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    };

                    let next_idx = idx as i32 + direction;
                    if next_idx < 0 || next_idx >= rows.len() as i32 {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    }
                    let next_idx = next_idx as usize;

                    let left_pos = rows[idx].queue_position;
                    let right_pos = rows[next_idx].queue_position;

                    let mut left: download_jobs::ActiveModel = rows[idx].clone().into();
                    left.queue_position = Set(right_pos);
                    left.updated_at = Set(chrono::Utc::now().into());
                    left.update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    let mut right: download_jobs::ActiveModel = rows[next_idx].clone().into();
                    right.queue_position = Set(left_pos);
                    right.updated_at = Set(chrono::Utc::now().into());
                    right
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    wake_download_queue_worker();
                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueuePauseJob",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueJobActionInput| async move {
                    use alloy_db::entities::download_jobs;
                    use sea_orm::{ActiveModelTrait, EntityTrait, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let job_id =
                        sea_orm::prelude::Uuid::parse_str(input.job_id.trim()).map_err(|_| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                "invalid job id",
                                "job_id",
                                "invalid uuid",
                            )
                        })?;

                    let Some(model) = download_jobs::Entity::find_by_id(job_id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?
                    else {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    };
                    if model.state != DOWNLOAD_STATE_QUEUED {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    }

                    let mut active: download_jobs::ActiveModel = model.into();
                    active.state = Set(DOWNLOAD_STATE_PAUSED.to_string());
                    active.message = Set("paused in queue".to_string());
                    active.updated_at = Set(chrono::Utc::now().into());
                    active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueueResumeJob",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueJobActionInput| async move {
                    use alloy_db::entities::download_jobs;
                    use sea_orm::{ActiveModelTrait, EntityTrait, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let job_id =
                        sea_orm::prelude::Uuid::parse_str(input.job_id.trim()).map_err(|_| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                "invalid job id",
                                "job_id",
                                "invalid uuid",
                            )
                        })?;

                    let Some(model) = download_jobs::Entity::find_by_id(job_id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?
                    else {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    };
                    if model.state != DOWNLOAD_STATE_PAUSED {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    }

                    let mut active: download_jobs::ActiveModel = model.into();
                    active.state = Set(DOWNLOAD_STATE_QUEUED.to_string());
                    active.message = Set("queued for download".to_string());
                    active.updated_at = Set(chrono::Utc::now().into());
                    active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    wake_download_queue_worker();
                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueueCancelJob",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueJobActionInput| async move {
                    use alloy_db::entities::download_jobs;
                    use sea_orm::{ActiveModelTrait, EntityTrait, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let job_id =
                        sea_orm::prelude::Uuid::parse_str(input.job_id.trim()).map_err(|_| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                "invalid job id",
                                "job_id",
                                "invalid uuid",
                            )
                        })?;

                    let Some(model) = download_jobs::Entity::find_by_id(job_id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?
                    else {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    };
                    if model.state != DOWNLOAD_STATE_QUEUED && model.state != DOWNLOAD_STATE_PAUSED
                    {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    }

                    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
                    let mut active: download_jobs::ActiveModel = model.into();
                    active.state = Set(DOWNLOAD_STATE_CANCELED.to_string());
                    active.message = Set("canceled by user".to_string());
                    active.updated_at = Set(now);
                    active.finished_at = Set(Some(now));
                    active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    let _ = trim_download_history(&*ctx.db, 50).await;
                    wake_download_queue_worker();
                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueueRetryJob",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: DownloadQueueJobActionInput| async move {
                    use alloy_db::entities::download_jobs;
                    use sea_orm::{ActiveModelTrait, EntityTrait, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let job_id =
                        sea_orm::prelude::Uuid::parse_str(input.job_id.trim()).map_err(|_| {
                            api_error_with_field(
                                &ctx,
                                "invalid_param",
                                "invalid job id",
                                "job_id",
                                "invalid uuid",
                            )
                        })?;

                    let Some(model) = download_jobs::Entity::find_by_id(job_id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?
                    else {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    };

                    if model.state != DOWNLOAD_STATE_SUCCESS
                        && model.state != DOWNLOAD_STATE_ERROR
                        && model.state != DOWNLOAD_STATE_CANCELED
                        && model.state != DOWNLOAD_STATE_PAUSED
                    {
                        return Ok(DownloadQueueMutationOutput { ok: true });
                    }

                    let now: sea_orm::prelude::DateTimeWithTimeZone = chrono::Utc::now().into();
                    let next_pos = download_queue_next_position(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    let mut active: download_jobs::ActiveModel = model.into();
                    active.state = Set(DOWNLOAD_STATE_QUEUED.to_string());
                    active.message = Set("queued for retry".to_string());
                    active.request_id = Set(None);
                    active.queue_position = Set(next_pos);
                    active.started_at = Set(None);
                    active.finished_at = Set(None);
                    active.updated_at = Set(now);
                    active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    wake_download_queue_worker();
                    Ok(DownloadQueueMutationOutput { ok: true })
                },
            ),
        )
        .procedure(
            "downloadQueueClearHistory",
            Procedure::builder::<ApiError>().mutation(|ctx, _: ()| async move {
                use alloy_db::entities::download_jobs;
                use sea_orm::{ColumnTrait, Condition, EntityTrait, QueryFilter};

                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let terminal = Condition::any()
                    .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_SUCCESS))
                    .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_ERROR))
                    .add(download_jobs::Column::State.eq(DOWNLOAD_STATE_CANCELED));
                let _ = download_jobs::Entity::delete_many()
                    .filter(terminal)
                    .exec(&*ctx.db)
                    .await
                    .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                Ok(DownloadQueueMutationOutput { ok: true })
            }),
        );

    let fs = Router::new()
        .procedure(
            "capabilities",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::GetCapabilitiesResponse = transport
                    .call(
                        "/alloy.agent.v1.FilesystemService/GetCapabilities",
                        GetCapabilitiesRequest {},
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "fs.get_capabilities", status)
                    })?;

                Ok(FsCapabilitiesOutput {
                    write_enabled: resp.write_enabled,
                })
            }),
        )
        .procedure(
            "listDir",
            Procedure::builder::<ApiError>().query(|ctx, input: ListDirInput| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::ListDirResponse = transport
                    .call(
                        "/alloy.agent.v1.FilesystemService/ListDir",
                        ListDirRequest {
                            path: input.path.unwrap_or_default(),
                        },
                    )
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "fs.list_dir", status))?;

                Ok(ListDirOutput {
                    entries: resp
                        .entries
                        .into_iter()
                        .map(|e| DirEntryDto {
                            name: e.name,
                            is_dir: e.is_dir,
                            size_bytes: clamp_u64_to_u32(e.size_bytes),
                            modified_unix_ms: e.modified_unix_ms.to_string(),
                        })
                        .collect(),
                })
            }),
        )
        .procedure(
            "readFile",
            Procedure::builder::<ApiError>().query(|ctx, input: ReadFileInput| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::ReadFileResponse = transport
                    .call(
                        "/alloy.agent.v1.FilesystemService/ReadFile",
                        ReadFileRequest {
                            path: input.path,
                            offset: input.offset.unwrap_or(0) as u64,
                            limit: input.limit.unwrap_or(0) as u64,
                        },
                    )
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "fs.read_file", status))?;

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
            let transport = agent_transport(&ctx);
            let resp: alloy_proto::agent_v1::TailFileResponse = transport
                .call(
                    "/alloy.agent.v1.LogsService/TailFile",
                    TailFileRequest {
                        path: input.path,
                        cursor: input.cursor.unwrap_or_default(),
                        limit_bytes: input.limit_bytes.unwrap_or(0),
                        max_lines: input.max_lines.unwrap_or(0),
                    },
                )
                .await
                .map_err(|status| api_error_from_agent_status(&ctx, "log.tail_file", status))?;

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

                    let mut params = input.params;

                    // Defaults and control-plane settings injection.
                    if input.template_id == "dst:vanilla" {
                        let current = params.get("cluster_token").map(|s| s.trim()).unwrap_or("");
                        if current.is_empty() {
                            if let Some(v) = setting_get(&*ctx.db, SETTING_DST_DEFAULT_KLEI_KEY)
                                .await
                                .map_err(|e| {
                                    api_error(&ctx, "db_error", format!("db error: {e}"))
                                })?
                            {
                                let v = v.trim().to_string();
                                if !v.is_empty() {
                                    params.insert("cluster_token".to_string(), v);
                                }
                            }
                        }
                    }

                    if input.template_id == "minecraft:curseforge" {
                        let current = params
                            .get("curseforge_api_key")
                            .map(|s| s.trim())
                            .unwrap_or("");
                        if current.is_empty() {
                            let v = setting_get(&*ctx.db, SETTING_CURSEFORGE_API_KEY)
                                .await
                                .map_err(|e| {
                                    api_error(&ctx, "db_error", format!("db error: {e}"))
                                })?;
                            let Some(v) = v else {
                                return Err(api_error(
                                    &ctx,
                                    "missing_setting",
                                    "CurseForge API key is not configured",
                                ));
                            };
                            let v = v.trim().to_string();
                            if v.is_empty() {
                                return Err(api_error(
                                    &ctx,
                                    "missing_setting",
                                    "CurseForge API key is not configured",
                                ));
                            }
                            params.insert("curseforge_api_key".to_string(), v);
                        }
                    }

                    let transport = agent_transport(&ctx);
                    let resp: alloy_proto::agent_v1::CreateInstanceResponse = transport
                        .call(
                            "/alloy.agent.v1.InstanceService/Create",
                            CreateInstanceRequest {
                                template_id: input.template_id,
                                params: params.into_iter().collect(),
                                display_name: input.display_name.unwrap_or_default(),
                            },
                        )
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.create", status)
                        })?;

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
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::GetInstanceResponse = transport
                    .call(
                        "/alloy.agent.v1.InstanceService/Get",
                        GetInstanceRequest {
                            instance_id: input.instance_id,
                        },
                    )
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.get", status))?;

                let info = resp
                    .info
                    .ok_or_else(|| api_error(&ctx, "internal", "missing instance info"))?;

                map_instance_info(&ctx, info)
            }),
        )
        .procedure(
            "list",
            Procedure::builder::<ApiError>().query(|ctx, _: ()| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::ListInstancesResponse = transport
                    .call(
                        "/alloy.agent.v1.InstanceService/List",
                        ListInstancesRequest {},
                    )
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.list", status))?;

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

                    let transport = agent_transport(&ctx);

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

                    let instance_json = match transport
                        .call::<_, alloy_proto::agent_v1::ReadFileResponse>(
                            "/alloy.agent.v1.FilesystemService/ReadFile",
                            ReadFileRequest {
                                path: format!("instances/{}/instance.json", instance_id),
                                offset: 0,
                                limit: 1024 * 1024,
                            },
                        )
                        .await
                    {
                        Ok(resp) => Some(to_utf8(resp.data)?),
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

                    let run_json = match transport
                        .call::<_, alloy_proto::agent_v1::ReadFileResponse>(
                            "/alloy.agent.v1.FilesystemService/ReadFile",
                            ReadFileRequest {
                                path: format!("instances/{}/run.json", instance_id),
                                offset: 0,
                                limit: 1024 * 1024,
                            },
                        )
                        .await
                    {
                        Ok(resp) => Some(to_utf8(resp.data)?),
                        Err(status) => {
                            if status.code() != tonic::Code::NotFound {
                                return Err(api_error_from_agent_status(
                                    &ctx,
                                    "instance.diagnostics.read_file(run.json)",
                                    status,
                                ));
                            }

                            match transport
                                .call::<_, alloy_proto::agent_v1::ReadFileResponse>(
                                    "/alloy.agent.v1.FilesystemService/ReadFile",
                                    ReadFileRequest {
                                        path: format!("processes/{}/run.json", instance_id),
                                        offset: 0,
                                        limit: 1024 * 1024,
                                    },
                                )
                                .await
                            {
                                Ok(resp) => Some(to_utf8(resp.data)?),
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

                    let console_log_lines = match transport
                        .call::<_, alloy_proto::agent_v1::TailFileResponse>(
                            "/alloy.agent.v1.LogsService/TailFile",
                            TailFileRequest {
                                path: format!("instances/{}/logs/console.log", instance_id),
                                cursor: "0".to_string(),
                                limit_bytes,
                                max_lines,
                            },
                        )
                        .await
                    {
                        Ok(resp) => resp.lines,
                        Err(status) => {
                            if status.code() != tonic::Code::NotFound {
                                return Err(api_error_from_agent_status(
                                    &ctx,
                                    "instance.diagnostics.tail_file(console.log)",
                                    status,
                                ));
                            }

                            match transport
                                .call::<_, alloy_proto::agent_v1::TailFileResponse>(
                                    "/alloy.agent.v1.LogsService/TailFile",
                                    TailFileRequest {
                                        path: format!("processes/{}/logs/console.log", instance_id),
                                        cursor: "0".to_string(),
                                        limit_bytes,
                                        max_lines,
                                    },
                                )
                                .await
                            {
                                Ok(resp) => resp.lines,
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

                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::StartInstanceResponse = transport
                    .call(
                        "/alloy.agent.v1.InstanceService/Start",
                        StartInstanceRequest {
                            instance_id: input.instance_id,
                        },
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "instance.start", status)
                    })?;

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

                    let transport = agent_transport(&ctx);

                    // Best-effort: if the instance isn't running, the stop call may return NOT_FOUND.
                    // Treat that as "already stopped" and continue to start.
                    match transport
                        .call::<_, alloy_proto::agent_v1::StopInstanceResponse>(
                            "/alloy.agent.v1.InstanceService/Stop",
                            StopInstanceRequest {
                                instance_id: input.instance_id.clone(),
                                timeout_ms: input.timeout_ms.unwrap_or(30_000),
                            },
                        )
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

                    let resp: alloy_proto::agent_v1::StartInstanceResponse = transport
                        .call(
                            "/alloy.agent.v1.InstanceService/Start",
                            StartInstanceRequest {
                                instance_id: input.instance_id,
                            },
                        )
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.start", status)
                        })?;

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

                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::StopInstanceResponse = transport
                    .call(
                        "/alloy.agent.v1.InstanceService/Stop",
                        StopInstanceRequest {
                            instance_id: input.instance_id,
                            timeout_ms: input.timeout_ms.unwrap_or(30_000),
                        },
                    )
                    .await
                    .map_err(|status| api_error_from_agent_status(&ctx, "instance.stop", status))?;

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

                    let transport = agent_transport(&ctx);
                    let resp: alloy_proto::agent_v1::UpdateInstanceResponse = transport
                        .call(
                            "/alloy.agent.v1.InstanceService/Update",
                            UpdateInstanceRequest {
                                instance_id: input.instance_id.clone(),
                                params: input.params.into_iter().collect(),
                                display_name: input.display_name.unwrap_or_default(),
                            },
                        )
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.update", status)
                        })?;

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
            "importSaveFromUrl",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: ImportSaveFromUrlInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let transport = agent_transport(&ctx);
                    let resp: alloy_proto::agent_v1::ImportSaveFromUrlResponse = transport
                        .call(
                            "/alloy.agent.v1.InstanceService/ImportSaveFromUrl",
                            alloy_proto::agent_v1::ImportSaveFromUrlRequest {
                                instance_id: input.instance_id.clone(),
                                url: input.url,
                            },
                        )
                        .await
                        .map_err(|status| {
                            api_error_from_agent_status(&ctx, "instance.import_save", status)
                        })?;

                    if resp.ok {
                        audit::record(
                            &ctx,
                            "instance.import_save",
                            &input.instance_id,
                            Some(serde_json::json!({ "installed_path": resp.installed_path })),
                        )
                        .await;
                    }

                    Ok(ImportSaveFromUrlOutput {
                        ok: resp.ok,
                        message: resp.message,
                        installed_path: resp.installed_path,
                        backup_path: resp.backup_path,
                    })
                },
            ),
        )
        .procedure(
            "deletePreview",
            Procedure::builder::<ApiError>().query(|ctx, input: InstanceIdInput| async move {
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::DeleteInstancePreviewResponse = transport
                    .call(
                        "/alloy.agent.v1.InstanceService/DeletePreview",
                        DeleteInstancePreviewRequest {
                            instance_id: input.instance_id,
                        },
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "instance.delete_preview", status)
                    })?;

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

                let instance_id = input.instance_id;
                let transport = agent_transport(&ctx);
                let resp: alloy_proto::agent_v1::DeleteInstanceResponse = transport
                    .call(
                        "/alloy.agent.v1.InstanceService/Delete",
                        DeleteInstanceRequest {
                            instance_id: instance_id.clone(),
                        },
                    )
                    .await
                    .map_err(|status| {
                        api_error_from_agent_status(&ctx, "instance.delete", status)
                    })?;

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
                        has_connect_token: n.connect_token_hash.is_some(),
                        enabled: n.enabled,
                        last_seen_at: n.last_seen_at.map(|t| t.to_rfc3339()),
                        agent_version: n.agent_version,
                        last_error: n.last_error,
                    })
                    .collect::<Vec<_>>())
            }),
        )
        .procedure(
            "create",
            Procedure::builder::<ApiError>().mutation(
                |ctx: Ctx, input: NodeCreateInput| async move {
                    use alloy_db::entities::nodes;
                    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    if !user.is_admin {
                        return Err(api_error(&ctx, "forbidden", "forbidden"));
                    }

                    let name = normalize_node_name(&input.name).map_err(|_| {
                        api_error_with_field(
                            &ctx,
                            "invalid_param",
                            "invalid node name",
                            "name",
                            "invalid name",
                        )
                    })?;

                    let existing = nodes::Entity::find()
                        .filter(nodes::Column::Name.eq(name.clone()))
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    if existing.is_some() {
                        return Err(api_error_with_field(
                            &ctx,
                            "already_exists",
                            "node already exists",
                            "name",
                            "name already exists",
                        ));
                    }

                    let token = random_token(32);
                    let token_hash = hash_token(&token);
                    let endpoint = format!("tunnel://{name}");

                    let model = nodes::ActiveModel {
                        id: Set(sea_orm::prelude::Uuid::new_v4()),
                        name: Set(name.clone()),
                        endpoint: Set(endpoint),
                        connect_token_hash: Set(Some(token_hash)),
                        enabled: Set(true),
                        last_seen_at: Set(None),
                        agent_version: Set(None),
                        last_error: Set(None),
                        created_at: Set(chrono::Utc::now().into()),
                        updated_at: Set(chrono::Utc::now().into()),
                    };

                    let inserted = nodes::Entity::insert(model)
                        .exec_with_returning(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    audit::record(&ctx, "node.create", &inserted.id.to_string(), None).await;

                    Ok(NodeCreateOutput {
                        node: NodeDto {
                            id: inserted.id.to_string(),
                            name: inserted.name,
                            endpoint: inserted.endpoint,
                            has_connect_token: inserted.connect_token_hash.is_some(),
                            enabled: inserted.enabled,
                            last_seen_at: inserted.last_seen_at.map(|t| t.to_rfc3339()),
                            agent_version: inserted.agent_version,
                            last_error: inserted.last_error,
                        },
                        connect_token: token,
                    })
                },
            ),
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
                        has_connect_token: updated.connect_token_hash.is_some(),
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

    let settings = Router::new()
        .procedure(
            "status",
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                settings_status_output(&ctx).await
            }),
        )
        .procedure(
            "setDstDefaultKleiKey",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: SetDstDefaultKleiKeyInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    if !user.is_admin {
                        return Err(api_error(&ctx, "forbidden", "forbidden"));
                    }

                    let v = input.key.trim().to_string();
                    if v.is_empty() {
                        setting_clear(&*ctx.db, SETTING_DST_DEFAULT_KLEI_KEY)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    } else {
                        setting_set_secret(&*ctx.db, SETTING_DST_DEFAULT_KLEI_KEY, &v)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    }

                    audit::record(
                        &ctx,
                        "settings.setDstDefaultKleiKey",
                        SETTING_DST_DEFAULT_KLEI_KEY,
                        None,
                    )
                    .await;

                    settings_status_output(&ctx).await
                },
            ),
        )
        .procedure(
            "setCurseforgeApiKey",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: SetCurseforgeApiKeyInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    if !user.is_admin {
                        return Err(api_error(&ctx, "forbidden", "forbidden"));
                    }

                    let v = input.key.trim().to_string();
                    if v.is_empty() {
                        setting_clear(&*ctx.db, SETTING_CURSEFORGE_API_KEY)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    } else {
                        setting_set_secret(&*ctx.db, SETTING_CURSEFORGE_API_KEY, &v)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    }

                    audit::record(
                        &ctx,
                        "settings.setCurseforgeApiKey",
                        SETTING_CURSEFORGE_API_KEY,
                        None,
                    )
                    .await;

                    settings_status_output(&ctx).await
                },
            ),
        )
        .procedure(
            "setSteamcmdCredentials",
            Procedure::builder::<ApiError>().mutation(
                |ctx, input: SetSteamcmdCredentialsInput| async move {
                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    if !user.is_admin {
                        return Err(api_error(&ctx, "forbidden", "forbidden"));
                    }

                    let mut username = input.username.trim().to_string();
                    let password = input.password.to_string();
                    let steam_guard_code = normalize_steam_guard_code(input.steam_guard_code.as_deref());
                    let mut shared_secret = input
                        .shared_secret
                        .as_deref()
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                        .map(ToString::to_string);
                    let mut account_name: Option<String> = None;

                    if let Some(raw) = input
                        .mafile_json
                        .as_deref()
                        .map(str::trim)
                        .filter(|v| !v.is_empty())
                    {
                        let (ma_account_name, ma_shared_secret) = parse_steam_mafile_or_secret(raw)
                            .map_err(|e| {
                                api_error_with_field(
                                    &ctx,
                                    "invalid_param",
                                    format!("invalid maFile: {e}"),
                                    "mafile_json",
                                    "Paste a valid maFile JSON (with shared_secret).",
                                )
                            })?;
                        if shared_secret.is_none() {
                            shared_secret = Some(ma_shared_secret);
                        }
                        account_name = ma_account_name;
                    }

                    if let Some(secret) = shared_secret.as_deref() {
                        use base64::Engine;
                        base64::engine::general_purpose::STANDARD
                            .decode(secret.as_bytes())
                            .map_err(|_| {
                                api_error_with_field(
                                    &ctx,
                                    "invalid_param",
                                    "invalid shared_secret",
                                    "shared_secret",
                                    "shared_secret must be valid base64",
                                )
                            })?;
                    }

                    if username.is_empty() {
                        if let Some(acc) = account_name.clone()
                            && !acc.trim().is_empty()
                        {
                            username = acc.trim().to_string();
                        }
                    }

                    let clear_requested = username.is_empty()
                        && password.is_empty()
                        && steam_guard_code.is_none()
                        && shared_secret.is_none()
                        && account_name.is_none();

                    if clear_requested {
                        setting_clear(&*ctx.db, SETTING_STEAMCMD_USERNAME)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                        setting_clear(&*ctx.db, SETTING_STEAMCMD_PASSWORD)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                        setting_clear(&*ctx.db, SETTING_STEAMCMD_SHARED_SECRET)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                        setting_clear(&*ctx.db, SETTING_STEAMCMD_ACCOUNT_NAME)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    } else if username.is_empty() || password.is_empty() {
                        return Err(api_error(
                            &ctx,
                            "invalid_param",
                            "SteamCMD username and password are required (or leave all fields empty to clear)",
                        ));
                    } else {
                        let guard_attempts: Vec<Option<String>> = if let Some(code) = steam_guard_code.clone() {
                            vec![Some(code)]
                        } else if let Some(secret) = shared_secret.as_deref() {
                            generate_steam_guard_candidates(secret)
                                .map_err(|e| {
                                    api_error_with_field(
                                        &ctx,
                                        "invalid_param",
                                        format!("failed to generate Steam Guard code: {e}"),
                                        "shared_secret",
                                        "Re-import maFile/shared_secret and retry.",
                                    )
                                })?
                                .into_iter()
                                .map(Some)
                                .collect()
                        } else {
                            vec![None]
                        };

                        let mut verified = false;
                        let mut last_guard_error: Option<ApiError> = None;

                        for (index, code) in guard_attempts.iter().enumerate() {
                            match verify_steamcmd_login_via_agent(
                                &ctx,
                                &username,
                                &password,
                                code.as_deref(),
                            )
                            .await
                            {
                                Ok(()) => {
                                    verified = true;
                                    break;
                                }
                                Err(err) => {
                                    let guard_err = err.field_errors.contains_key("steam_guard_code");
                                    let has_more = index + 1 < guard_attempts.len();
                                    if guard_err && has_more {
                                        last_guard_error = Some(err);
                                        continue;
                                    }
                                    return Err(err);
                                }
                            }
                        }

                        if !verified {
                            if let Some(_secret) = shared_secret.as_deref()
                                && steam_guard_code.is_none()
                            {
                                let mut err = api_error_with_field(
                                    &ctx,
                                    "invalid_param",
                                    "Auto 2FA failed: generated Steam Guard code was rejected.",
                                    "steam_guard_code",
                                    "Re-import maFile/shared_secret or enter a fresh Steam Guard code manually.",
                                );
                                err.hint = Some(
                                    "If this keeps failing, check system time sync on the agent/control host."
                                        .to_string(),
                                );
                                return Err(err);
                            }
                            if let Some(err) = last_guard_error {
                                return Err(err);
                            }
                            return Err(api_error(
                                &ctx,
                                "invalid_param",
                                "SteamCMD login verification failed",
                            ));
                        }

                        setting_set_secret(&*ctx.db, SETTING_STEAMCMD_USERNAME, &username)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                        setting_set_secret(&*ctx.db, SETTING_STEAMCMD_PASSWORD, &password)
                            .await
                            .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                        if let Some(secret) = shared_secret.as_deref() {
                            setting_set_secret(&*ctx.db, SETTING_STEAMCMD_SHARED_SECRET, secret)
                                .await
                                .map_err(|e| {
                                    api_error(&ctx, "db_error", format!("db error: {e}"))
                                })?;
                        } else {
                            setting_clear(&*ctx.db, SETTING_STEAMCMD_SHARED_SECRET)
                                .await
                                .map_err(|e| {
                                    api_error(&ctx, "db_error", format!("db error: {e}"))
                                })?;
                        }

                        if let Some(name) = account_name
                            .map(|v| v.trim().to_string())
                            .filter(|v| !v.is_empty())
                        {
                            setting_set_secret(&*ctx.db, SETTING_STEAMCMD_ACCOUNT_NAME, &name)
                                .await
                                .map_err(|e| {
                                    api_error(&ctx, "db_error", format!("db error: {e}"))
                                })?;
                        } else {
                            setting_set_secret(&*ctx.db, SETTING_STEAMCMD_ACCOUNT_NAME, &username)
                                .await
                                .map_err(|e| {
                                    api_error(&ctx, "db_error", format!("db error: {e}"))
                                })?;
                        }
                    }

                    audit::record(&ctx, "settings.setSteamcmdCredentials", "steamcmd.credentials", None)
                        .await;

                    settings_status_output(&ctx).await
                },
            ),
        );

    let update = Router::new()
        .procedure(
            "check",
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                let user = ctx
                    .user
                    .clone()
                    .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                if !user.is_admin {
                    return Err(api_error(&ctx, "forbidden", "forbidden"));
                }

                let current_version = env!("CARGO_PKG_VERSION").to_string();
                let current = crate::update::parse_simple_version(&current_version);

                let latest = crate::update::latest_release().await.map_err(|e| {
                    api_error(
                        &ctx,
                        "upstream_error",
                        format!("update.check failed: {e}"),
                    )
                })?;

                let latest_version = crate::update::parse_simple_version(&latest.tag_name)
                    .map(|v| format!("{}.{}.{}", v.major, v.minor, v.patch));
                let latest_parsed = crate::update::parse_simple_version(&latest.tag_name);
                let update_available = match (current, latest_parsed) {
                    (Some(cur), Some(lat)) => lat > cur,
                    _ => false,
                };

                Ok(UpdateCheckOutput {
                    current_version,
                    latest: Some(UpdateLatestReleaseDto {
                        tag: latest.tag_name.clone(),
                        version: latest_version,
                        url: latest.html_url.clone(),
                        published_at: latest.published_at.clone(),
                        body: latest.body.as_deref().and_then(|b| {
                            let trimmed = b.trim();
                            if trimmed.is_empty() {
                                return None;
                            }
                            // Keep payload bounded; the UI can link to the full release page.
                            const MAX: usize = 16 * 1024;
                            if trimmed.len() <= MAX {
                                return Some(trimmed.to_string());
                            }
                            let mut out = trimmed[..MAX].to_string();
                            out.push_str("\n…");
                            Some(out)
                        }),
                    }),
                    update_available,
                    can_trigger_update: crate::update::watchtower_configured(),
                })
            }),
        )
        .procedure(
            "trigger",
            Procedure::builder::<ApiError>().mutation(|ctx: Ctx, _: ()| async move {
                ensure_writable(&ctx)?;
                enforce_rate_limit(&ctx)?;

                let user = ctx
                    .user
                    .clone()
                    .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                if !user.is_admin {
                    return Err(api_error(&ctx, "forbidden", "forbidden"));
                }

                if !crate::update::watchtower_configured() {
                    let mut err = api_error(&ctx, "not_supported", "updater is not configured");
                    err.hint = Some(
                        "Set ALLOY_UPDATE_WATCHTOWER_URL and ALLOY_UPDATE_WATCHTOWER_TOKEN, then restart control."
                            .to_string(),
                    );
                    return Err(err);
                }

                let msg = crate::update::trigger_watchtower_update()
                    .await
                    .map_err(|e| {
                        api_error(
                            &ctx,
                            "updater_failed",
                            format!("trigger watchtower update failed: {e}"),
                        )
                    })?;

                audit::record(&ctx, "update.trigger", "watchtower", None).await;

                Ok(UpdateTriggerOutput {
                    ok: true,
                    message: msg,
                })
            }),
        );

    let frp = Router::new()
        .procedure(
            "list",
            Procedure::builder::<ApiError>().query(|ctx: Ctx, _: ()| async move {
                use alloy_db::entities::frp_nodes;
                use sea_orm::{ColumnTrait, EntityTrait, QueryFilter, QueryOrder};

                let user = ctx
                    .user
                    .clone()
                    .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                let user_id = sea_orm::prelude::Uuid::parse_str(&user.user_id)
                    .map_err(|_| api_error(&ctx, "unauthorized", "unauthorized"))?;

                let rows = frp_nodes::Entity::find()
                    .filter(frp_nodes::Column::UserId.eq(user_id))
                    .order_by_asc(frp_nodes::Column::Name)
                    .all(&*ctx.db)
                    .await
                    .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                let mut out = Vec::with_capacity(rows.len());
                let mut probe_jobs: Vec<(usize, String, u16)> = Vec::new();

                for n in rows {
                    let inferred = parse_frp_endpoint_from_text(&n.config);
                    let server_addr = n
                        .server_addr
                        .clone()
                        .or_else(|| inferred.as_ref().map(|v| v.0.clone()));
                    let server_port = n
                        .server_port
                        .and_then(|v| u16::try_from(v).ok())
                        .or_else(|| inferred.as_ref().map(|v| v.1));

                    let idx = out.len();
                    if let (Some(addr), Some(port)) = (&server_addr, server_port) {
                        probe_jobs.push((idx, addr.clone(), port));
                    }

                    out.push(FrpNodeDto {
                        id: n.id.to_string(),
                        name: n.name,
                        server_addr,
                        server_port,
                        allocatable_ports: n.allocatable_ports,
                        token: n.token,
                        config: n.config,
                        latency_ms: None,
                        created_at: n.created_at.to_rfc3339(),
                        updated_at: n.updated_at.to_rfc3339(),
                    });
                }

                let probe_results = futures_util::future::join_all(
                    probe_jobs
                        .iter()
                        .map(|(_, addr, port)| probe_frp_tcp_latency_ms(addr, *port)),
                )
                .await;
                for ((idx, _, _), latency_ms) in
                    probe_jobs.into_iter().zip(probe_results.into_iter())
                {
                    if let Some(item) = out.get_mut(idx) {
                        item.latency_ms = latency_ms;
                    }
                }

                Ok(out)
            }),
        )
        .procedure(
            "create",
            Procedure::builder::<ApiError>().mutation(
                |ctx: Ctx, input: FrpNodeCreateInput| async move {
                    use alloy_db::entities::frp_nodes;
                    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    let user_id = sea_orm::prelude::Uuid::parse_str(&user.user_id)
                        .map_err(|_| api_error(&ctx, "unauthorized", "unauthorized"))?;

                    let payload = normalize_frp_node_payload(
                        &ctx,
                        &input.name,
                        input.server_addr.as_deref(),
                        input.server_port,
                        input.allocatable_ports.as_deref(),
                        input.token.as_deref(),
                        &input.config,
                    )?;
                    let name = payload.name.clone();

                    let existing = frp_nodes::Entity::find()
                        .filter(frp_nodes::Column::UserId.eq(user_id))
                        .filter(frp_nodes::Column::Name.eq(name.clone()))
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    if existing.is_some() {
                        return Err(api_error_with_field(
                            &ctx,
                            "already_exists",
                            "frp node already exists",
                            "name",
                            "name already exists",
                        ));
                    }

                    let now: chrono::DateTime<chrono::FixedOffset> = chrono::Utc::now().into();
                    let model = frp_nodes::ActiveModel {
                        id: Set(sea_orm::prelude::Uuid::new_v4()),
                        user_id: Set(user_id),
                        name: Set(name.clone()),
                        server_addr: Set(payload.server_addr.clone()),
                        server_port: Set(payload.server_port.map(i32::from)),
                        allocatable_ports: Set(payload.allocatable_ports.clone()),
                        token: Set(payload.token.clone()),
                        config: Set(payload.config),
                        created_at: Set(now),
                        updated_at: Set(now),
                    };

                    let inserted = model
                        .insert(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    audit::record(
                        &ctx,
                        "frp.create",
                        &inserted.id.to_string(),
                        Some(serde_json::json!({ "name": inserted.name })),
                    )
                    .await;

                    let inferred = parse_frp_endpoint_from_text(&inserted.config);
                    let server_addr = inserted
                        .server_addr
                        .clone()
                        .or_else(|| inferred.as_ref().map(|v| v.0.clone()));
                    let server_port = inserted
                        .server_port
                        .and_then(|v| u16::try_from(v).ok())
                        .or_else(|| inferred.as_ref().map(|v| v.1));
                    let latency_ms = match (&server_addr, server_port) {
                        (Some(addr), Some(port)) => probe_frp_tcp_latency_ms(addr, port).await,
                        _ => None,
                    };

                    Ok(FrpNodeDto {
                        id: inserted.id.to_string(),
                        name: inserted.name,
                        server_addr,
                        server_port,
                        allocatable_ports: inserted.allocatable_ports,
                        token: inserted.token,
                        config: inserted.config,
                        latency_ms,
                        created_at: inserted.created_at.to_rfc3339(),
                        updated_at: inserted.updated_at.to_rfc3339(),
                    })
                },
            ),
        )
        .procedure(
            "update",
            Procedure::builder::<ApiError>().mutation(
                |ctx: Ctx, input: FrpNodeUpdateInput| async move {
                    use alloy_db::entities::frp_nodes;
                    use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    let user_id = sea_orm::prelude::Uuid::parse_str(&user.user_id)
                        .map_err(|_| api_error(&ctx, "unauthorized", "unauthorized"))?;

                    let id = sea_orm::prelude::Uuid::parse_str(&input.id)
                        .map_err(|_| api_error(&ctx, "invalid_param", "invalid id"))?;

                    let model = frp_nodes::Entity::find_by_id(id)
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?
                        .ok_or_else(|| api_error(&ctx, "not_found", "frp node not found"))?;
                    if model.user_id != user_id {
                        return Err(api_error(&ctx, "forbidden", "forbidden"));
                    }

                    let payload = normalize_frp_node_payload(
                        &ctx,
                        &input.name,
                        input.server_addr.as_deref(),
                        input.server_port,
                        input.allocatable_ports.as_deref(),
                        input.token.as_deref(),
                        &input.config,
                    )?;
                    let name = payload.name.clone();

                    let name_conflict = frp_nodes::Entity::find()
                        .filter(frp_nodes::Column::UserId.eq(user_id))
                        .filter(frp_nodes::Column::Name.eq(name.clone()))
                        .filter(frp_nodes::Column::Id.ne(id))
                        .one(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;
                    if name_conflict.is_some() {
                        return Err(api_error_with_field(
                            &ctx,
                            "already_exists",
                            "frp node already exists",
                            "name",
                            "name already exists",
                        ));
                    }

                    let mut active: frp_nodes::ActiveModel = model.into();
                    active.name = Set(name.clone());
                    active.server_addr = Set(payload.server_addr.clone());
                    active.server_port = Set(payload.server_port.map(i32::from));
                    active.allocatable_ports = Set(payload.allocatable_ports.clone());
                    active.token = Set(payload.token.clone());
                    active.config = Set(payload.config);
                    active.updated_at = Set(chrono::Utc::now().into());
                    let updated = active
                        .update(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    audit::record(
                        &ctx,
                        "frp.update",
                        &updated.id.to_string(),
                        Some(serde_json::json!({ "name": updated.name })),
                    )
                    .await;

                    let inferred = parse_frp_endpoint_from_text(&updated.config);
                    let server_addr = updated
                        .server_addr
                        .clone()
                        .or_else(|| inferred.as_ref().map(|v| v.0.clone()));
                    let server_port = updated
                        .server_port
                        .and_then(|v| u16::try_from(v).ok())
                        .or_else(|| inferred.as_ref().map(|v| v.1));
                    let latency_ms = match (&server_addr, server_port) {
                        (Some(addr), Some(port)) => probe_frp_tcp_latency_ms(addr, port).await,
                        _ => None,
                    };

                    Ok(FrpNodeDto {
                        id: updated.id.to_string(),
                        name: updated.name,
                        server_addr,
                        server_port,
                        allocatable_ports: updated.allocatable_ports,
                        token: updated.token,
                        config: updated.config,
                        latency_ms,
                        created_at: updated.created_at.to_rfc3339(),
                        updated_at: updated.updated_at.to_rfc3339(),
                    })
                },
            ),
        )
        .procedure(
            "delete",
            Procedure::builder::<ApiError>().mutation(
                |ctx: Ctx, input: FrpNodeDeleteInput| async move {
                    use alloy_db::entities::frp_nodes;
                    use sea_orm::{ColumnTrait, EntityTrait, QueryFilter};

                    ensure_writable(&ctx)?;
                    enforce_rate_limit(&ctx)?;

                    let user = ctx
                        .user
                        .clone()
                        .ok_or_else(|| api_error(&ctx, "unauthorized", "unauthorized"))?;
                    let user_id = sea_orm::prelude::Uuid::parse_str(&user.user_id)
                        .map_err(|_| api_error(&ctx, "unauthorized", "unauthorized"))?;

                    let id = sea_orm::prelude::Uuid::parse_str(&input.id)
                        .map_err(|_| api_error(&ctx, "invalid_param", "invalid id"))?;

                    let rows = frp_nodes::Entity::delete_many()
                        .filter(frp_nodes::Column::Id.eq(id))
                        .filter(frp_nodes::Column::UserId.eq(user_id))
                        .exec(&*ctx.db)
                        .await
                        .map_err(|e| api_error(&ctx, "db_error", format!("db error: {e}")))?;

                    if rows.rows_affected == 0 {
                        return Err(api_error(&ctx, "not_found", "frp node not found"));
                    }

                    audit::record(&ctx, "frp.delete", &id.to_string(), None).await;

                    Ok(FrpNodeDeleteOutput { ok: true })
                },
            ),
        );

    Router::new()
        .nest("control", control)
        .nest("agent", agent)
        .nest("process", process)
        .nest("minecraft", minecraft)
        .nest("settings", settings)
        .nest("update", update)
        .nest("frp", frp)
        .nest("fs", fs)
        .nest("log", log)
        .nest("instance", instance)
        .nest("node", node)
}
