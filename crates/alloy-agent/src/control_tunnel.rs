#![allow(clippy::result_large_err)]

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use reqwest::{Client, StatusCode};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{Message as WsMessage, client::IntoClientRequest};
use tracing::{Instrument, info_span};

use alloy_proto::agent_v1::{
    ClearCacheRequest, CreateInstanceRequest, DeleteInstancePreviewRequest, DeleteInstanceRequest,
    GetCacheStatsRequest, GetCapabilitiesRequest, GetInstanceRequest, GetSelfUpdateStatusRequest,
    GetStatusRequest, GetWarmTemplateProgressRequest, HealthCheckRequest,
    ImportSaveFromPathRequest, ImportSaveFromUrlRequest, ListDirRequest, ListInstancesRequest,
    ListProcessesRequest, ListTemplatesRequest, MkdirRequest, ReadFileRequest, RenameRequest,
    StartFromTemplateRequest, StartInstanceRequest, StopInstanceRequest, StopProcessRequest,
    TailFileRequest, TailLogsRequest, TriggerSelfUpdateRequest, UpdateInstanceRequest,
    WarmTemplateCacheRequest, WriteFileRequest, agent_health_service_server::AgentHealthService,
    agent_update_service_server::AgentUpdateService, filesystem_service_server::FilesystemService,
    instance_service_server::InstanceService, logs_service_server::LogsService,
    process_service_server::ProcessService,
};
use tonic::{Request, Status};

use crate::process_manager::ProcessManager;

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
enum AgentToControlFrame {
    #[serde(rename = "hello")]
    Hello { node: String, agent_version: String },
    #[serde(rename = "resp")]
    Resp {
        id: String,
        ok: bool,
        payload_b64: Option<String>,
        status_code: Option<i32>,
        status_message: Option<String>,
    },
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "type")]
enum ControlToAgentFrame {
    #[serde(rename = "req")]
    Req {
        id: String,
        method: String,
        payload_b64: String,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone)]
struct AgentRpc {
    health: crate::health_service::HealthApi,
    update: crate::self_update::SelfUpdateApi,
    fs: crate::filesystem_service::FilesystemApi,
    logs: crate::logs_service::LogsApi,
    process: crate::process_service::ProcessApi,
    instance: crate::instance_service::InstanceApi,
}

impl AgentRpc {
    fn new(manager: ProcessManager) -> Self {
        Self {
            health: crate::health_service::HealthApi,
            update: crate::self_update::SelfUpdateApi,
            fs: crate::filesystem_service::FilesystemApi,
            logs: crate::logs_service::LogsApi,
            process: crate::process_service::ProcessApi::new(manager.clone()),
            instance: crate::instance_service::InstanceApi::new(manager),
        }
    }

    fn decode_req<T: Message + Default>(&self, bytes: &[u8]) -> Result<T, Status> {
        T::decode(bytes).map_err(|_| Status::invalid_argument("invalid protobuf payload"))
    }

    async fn dispatch(&self, method: &str, payload: &[u8]) -> Result<Vec<u8>, Status> {
        match method {
            "/alloy.agent.v1.AgentHealthService/Check" => {
                let req: HealthCheckRequest = self.decode_req(payload)?;
                let resp = self.health.check(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.AgentUpdateService/GetSelfUpdateStatus" => {
                let req: GetSelfUpdateStatusRequest = self.decode_req(payload)?;
                let resp = self
                    .update
                    .get_self_update_status(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.AgentUpdateService/TriggerSelfUpdate" => {
                let req: TriggerSelfUpdateRequest = self.decode_req(payload)?;
                let resp = self
                    .update
                    .trigger_self_update(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }

            "/alloy.agent.v1.FilesystemService/GetCapabilities" => {
                let req: GetCapabilitiesRequest = self.decode_req(payload)?;
                let resp = self
                    .fs
                    .get_capabilities(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.FilesystemService/ListDir" => {
                let req: ListDirRequest = self.decode_req(payload)?;
                let resp = self.fs.list_dir(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.FilesystemService/ReadFile" => {
                let req: ReadFileRequest = self.decode_req(payload)?;
                let resp = self.fs.read_file(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.FilesystemService/Mkdir" => {
                let req: MkdirRequest = self.decode_req(payload)?;
                let resp = self.fs.mkdir(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.FilesystemService/WriteFile" => {
                let req: WriteFileRequest = self.decode_req(payload)?;
                let resp = self.fs.write_file(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.FilesystemService/Rename" => {
                let req: RenameRequest = self.decode_req(payload)?;
                let resp = self.fs.rename(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.FilesystemService/Remove" => {
                let req: alloy_proto::agent_v1::RemoveRequest = self.decode_req(payload)?;
                let resp = self.fs.remove(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }

            "/alloy.agent.v1.LogsService/TailFile" => {
                let req: TailFileRequest = self.decode_req(payload)?;
                let resp = self.logs.tail_file(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }

            "/alloy.agent.v1.ProcessService/ListTemplates" => {
                let req: ListTemplatesRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .list_templates(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/StartFromTemplate" => {
                let req: StartFromTemplateRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .start_from_template(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/WarmTemplateCache" => {
                let req: WarmTemplateCacheRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .warm_template_cache(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/GetWarmTemplateProgress" => {
                let req: GetWarmTemplateProgressRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .get_warm_template_progress(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/GetCacheStats" => {
                let req: GetCacheStatsRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .get_cache_stats(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/ClearCache" => {
                let req: ClearCacheRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .clear_cache(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/Stop" => {
                let req: StopProcessRequest = self.decode_req(payload)?;
                let resp = self.process.stop(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/ListProcesses" => {
                let req: ListProcessesRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .list_processes(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/GetStatus" => {
                let req: GetStatusRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .get_status(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/TailLogs" => {
                let req: TailLogsRequest = self.decode_req(payload)?;
                let resp = self
                    .process
                    .tail_logs(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }

            "/alloy.agent.v1.InstanceService/Create" => {
                let req: CreateInstanceRequest = self.decode_req(payload)?;
                let resp = self.instance.create(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/Get" => {
                let req: GetInstanceRequest = self.decode_req(payload)?;
                let resp = self.instance.get(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/List" => {
                let req: ListInstancesRequest = self.decode_req(payload)?;
                let resp = self.instance.list(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/Start" => {
                let req: StartInstanceRequest = self.decode_req(payload)?;
                let resp = self.instance.start(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/Stop" => {
                let req: StopInstanceRequest = self.decode_req(payload)?;
                let resp = self.instance.stop(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/Update" => {
                let req: UpdateInstanceRequest = self.decode_req(payload)?;
                let resp = self.instance.update(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/ImportSaveFromUrl" => {
                let req: ImportSaveFromUrlRequest = self.decode_req(payload)?;
                let resp = self
                    .instance
                    .import_save_from_url(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/ImportSaveFromPath" => {
                let req: ImportSaveFromPathRequest = self.decode_req(payload)?;
                let resp = self
                    .instance
                    .import_save_from_path(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/DeletePreview" => {
                let req: DeleteInstancePreviewRequest = self.decode_req(payload)?;
                let resp = self
                    .instance
                    .delete_preview(Request::new(req))
                    .await?
                    .into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.InstanceService/Delete" => {
                let req: DeleteInstanceRequest = self.decode_req(payload)?;
                let resp = self.instance.delete(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }

            _ => Err(Status::unimplemented(format!("unknown method: {method}"))),
        }
    }
}

fn parse_ws_url(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Support http(s) URLs by converting to ws(s).
    if let Some(rest) = trimmed.strip_prefix("https://") {
        return Some(format!("wss://{rest}"));
    }
    if let Some(rest) = trimmed.strip_prefix("http://") {
        return Some(format!("ws://{rest}"));
    }
    Some(trimmed.to_string())
}

fn parse_ws_urls(raw: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for part in raw.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
        let Some(url) = parse_ws_url(part) else {
            continue;
        };
        if out.iter().any(|v| v == &url) {
            continue;
        }
        out.push(url);
    }
    out
}

fn control_ws_urls() -> Vec<String> {
    if let Some(raw) = std::env::var("ALLOY_CONTROL_WS_URLS")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        let urls = parse_ws_urls(&raw);
        if !urls.is_empty() {
            return urls;
        }
    }

    std::env::var("ALLOY_CONTROL_WS_URL")
        .ok()
        .map(|v| parse_ws_urls(&v))
        .unwrap_or_default()
}

fn ws_ping_interval() -> Duration {
    const DEFAULT_MS: u64 = 5_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 120_000;

    let raw = std::env::var("ALLOY_CONTROL_WS_PING_INTERVAL_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);

    Duration::from_millis(ms)
}

fn ws_connect_timeout() -> Duration {
    const DEFAULT_MS: u64 = 15_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 300_000;

    let raw = std::env::var("ALLOY_CONTROL_WS_CONNECT_TIMEOUT_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);

    Duration::from_millis(ms)
}

fn ws_reconnect_backoff_base() -> Duration {
    const DEFAULT_MS: u64 = 500;
    const MIN_MS: u64 = 100;
    const MAX_MS: u64 = 10_000;

    let raw = std::env::var("ALLOY_CONTROL_WS_RECONNECT_BASE_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);

    Duration::from_millis(ms)
}

fn ws_reconnect_backoff_max(base: Duration) -> Duration {
    const DEFAULT_MS: u64 = 8_000;
    const MIN_MS: u64 = 500;
    const MAX_MS: u64 = 120_000;

    let raw = std::env::var("ALLOY_CONTROL_WS_RECONNECT_MAX_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);
    Duration::from_millis(ms).max(base)
}

fn ws_app_keepalive_interval(ping_interval: Duration) -> Option<Duration> {
    const DEFAULT_MS: u64 = 8_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 300_000;

    let raw = std::env::var("ALLOY_CONTROL_WS_APP_KEEPALIVE_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                return Some(DEFAULT_MS);
            }
            trimmed.parse::<u64>().ok()
        })
        .unwrap_or(DEFAULT_MS);

    if ms == 0 {
        return None;
    }

    Some(Duration::from_millis(ms.clamp(MIN_MS, MAX_MS)).max(ping_interval))
}

fn ws_idle_timeout(ping_interval: Duration) -> Option<Duration> {
    const MIN_MS: u64 = 5_000;
    const MAX_MS: u64 = 900_000;

    let raw = std::env::var("ALLOY_CONTROL_WS_IDLE_TIMEOUT_MS").ok();
    let configured = raw
        .as_deref()
        .and_then(|v| {
            let trimmed = v.trim();
            if trimmed.is_empty() {
                return None;
            }
            trimmed.parse::<u64>().ok()
        })
        .filter(|v| *v > 0)?
        .clamp(MIN_MS, MAX_MS);

    let min_recommended_ms = ping_interval
        .as_millis()
        .saturating_mul(3)
        .min(u64::MAX as u128) as u64;
    let min_recommended = Duration::from_millis(min_recommended_ms);
    Some(Duration::from_millis(configured).max(min_recommended))
}

fn reconnect_sleep_with_jitter(base: Duration) -> Duration {
    let jitter_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| (d.as_millis() as u64) % 751)
        .unwrap_or(0);
    base + Duration::from_millis(jitter_ms)
}

fn node_name() -> String {
    std::env::var("ALLOY_NODE_NAME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .or_else(|| {
            std::env::var("HOSTNAME")
                .ok()
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_else(|| "default".to_string())
}

fn node_token() -> Option<String> {
    std::env::var("ALLOY_NODE_TOKEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn spawn(manager: ProcessManager) {
    match control_tunnel_mode() {
        ControlTunnelMode::Ws => spawn_ws(manager),
        ControlTunnelMode::Poll => spawn_poll(manager),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ControlTunnelMode {
    Ws,
    Poll,
}

fn control_tunnel_mode() -> ControlTunnelMode {
    match std::env::var("ALLOY_CONTROL_TUNNEL_MODE")
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "poll" | "http" | "longpoll" | "long-poll" => ControlTunnelMode::Poll,
        _ => ControlTunnelMode::Ws,
    }
}

fn poll_wait() -> Duration {
    const DEFAULT_MS: u64 = 10_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 90_000;

    let raw = std::env::var("ALLOY_CONTROL_POLL_WAIT_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);

    Duration::from_millis(ms)
}

fn parse_any_urls(raw: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for part in raw.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|v| v == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn control_poll_endpoints() -> Vec<(String, String)> {
    let urls = std::env::var("ALLOY_CONTROL_POLL_URLS")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(|v| parse_any_urls(&v))
        .filter(|v| !v.is_empty())
        .unwrap_or_else(control_ws_urls);

    let mut out = Vec::<(String, String)>::new();
    for raw in urls {
        let Ok(mut url) = reqwest::Url::parse(&raw) else {
            continue;
        };
        let scheme = match url.scheme() {
            "ws" => "http",
            "wss" => "https",
            "http" => "http",
            "https" => "https",
            _ => continue,
        };
        let _ = url.set_scheme(scheme);
        url.set_query(None);
        url.set_fragment(None);

        let mut poll_url = url.clone();
        poll_url.set_path("/agent/poll");

        let mut resp_url = url;
        resp_url.set_path("/agent/resp");

        out.push((poll_url.to_string(), resp_url.to_string()));
    }
    out
}

fn spawn_ws(manager: ProcessManager) {
    let urls = control_ws_urls();
    if urls.is_empty() {
        return;
    }

    let node = node_name();
    let token = node_token();
    let rpc = AgentRpc::new(manager);

    tokio::spawn(async move {
        let span = info_span!("control_tunnel", node = %node, urls = %urls.join(","));
        async move {
            let reconnect_backoff_base = ws_reconnect_backoff_base();
            let reconnect_backoff_max = ws_reconnect_backoff_max(reconnect_backoff_base);
            let mut backoff = reconnect_backoff_base;
            let mut endpoint_idx = 0usize;
            loop {
                let url = &urls[endpoint_idx % urls.len()];
                let res = run_once(url, &node, token.as_deref(), &rpc).await;
                match res {
                    Ok(()) => {
                        // Clean close; reconnect with a small delay.
                        backoff = reconnect_backoff_base;
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, ws_url = %url, "control tunnel disconnected");
                        backoff = (backoff * 2).min(reconnect_backoff_max);
                    }
                }
                if urls.len() > 1 {
                    // Round-robin endpoints on every reconnect to avoid sticky bad edges.
                    endpoint_idx = (endpoint_idx + 1) % urls.len();
                }
                tokio::time::sleep(reconnect_sleep_with_jitter(backoff)).await;
            }
        }
        .instrument(span)
        .await;
    });
}

fn spawn_poll(manager: ProcessManager) {
    let endpoints = control_poll_endpoints();
    if endpoints.is_empty() {
        return;
    }

    let node = node_name();
    let token = node_token();
    let rpc = AgentRpc::new(manager);

    tokio::spawn(async move {
        let span = info_span!(
            "control_poll",
            node = %node,
            urls = %endpoints.iter().map(|(a, _)| a.as_str()).collect::<Vec<_>>().join(",")
        );
        async move {
            let connect_timeout = ws_connect_timeout();
            let client = Client::builder()
                .user_agent(format!("alloy-agent/{}", env!("CARGO_PKG_VERSION")))
                .connect_timeout(connect_timeout)
                .build()
                .ok();

            let Some(client) = client else {
                tracing::warn!("control poll disabled: failed to build HTTP client");
                return;
            };

            let reconnect_backoff_base = ws_reconnect_backoff_base();
            let reconnect_backoff_max = ws_reconnect_backoff_max(reconnect_backoff_base);
            let mut backoff = reconnect_backoff_base;
            let mut endpoint_idx = 0usize;
            loop {
                let (poll_url, resp_url) = &endpoints[endpoint_idx % endpoints.len()];
                let res = run_poll_loop(
                    &client,
                    poll_url,
                    resp_url,
                    &node,
                    token.as_deref(),
                    &rpc,
                )
                .await;
                match res {
                    Ok(()) => {
                        backoff = reconnect_backoff_base;
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, poll_url = %poll_url, "control poll disconnected");
                        backoff = (backoff * 2).min(reconnect_backoff_max);
                    }
                }
                if endpoints.len() > 1 {
                    endpoint_idx = (endpoint_idx + 1) % endpoints.len();
                }
                tokio::time::sleep(reconnect_sleep_with_jitter(backoff)).await;
            }
        }
        .instrument(span)
        .await;
    });
}

async fn run_poll_loop(
    client: &Client,
    poll_url: &str,
    resp_url: &str,
    node: &str,
    token: Option<&str>,
    rpc: &AgentRpc,
) -> anyhow::Result<()> {
    let wait = poll_wait();
    let b64 = base64::engine::general_purpose::STANDARD;
    loop {
        let mut req = client
            .get(poll_url)
            .query(&[("node", node), ("agent_version", env!("CARGO_PKG_VERSION"))])
            .timeout(wait + Duration::from_secs(10));
        if let Some(tok) = token {
            req = req.bearer_auth(tok);
        }

        let resp = req.send().await?;
        if resp.status() == StatusCode::NO_CONTENT {
            continue;
        }
        if resp.status() != StatusCode::OK {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let snippet = body.trim().lines().next().unwrap_or("").trim();
            return Err(anyhow::anyhow!(
                "control poll bad status {} ({})",
                status.as_u16(),
                snippet
            ));
        }

        let text = resp.text().await?;
        let frame = serde_json::from_str::<ControlToAgentFrame>(&text)
            .unwrap_or(ControlToAgentFrame::Unknown);
        match frame {
            ControlToAgentFrame::Req {
                id,
                method,
                payload_b64,
            } => {
                let payload = match b64.decode(payload_b64.as_bytes()) {
                    Ok(v) => v,
                    Err(_) => {
                        let resp = AgentToControlFrame::Resp {
                            id,
                            ok: false,
                            payload_b64: None,
                            status_code: Some(
                                Status::invalid_argument("invalid base64").code() as i32
                            ),
                            status_message: Some("invalid base64 payload".to_string()),
                        };
                        let _ = post_poll_resp(client, resp_url, node, token, &resp).await;
                        continue;
                    }
                };

                let rpc = rpc.clone();
                let client = client.clone();
                let resp_url = resp_url.to_string();
                let node = node.to_string();
                let token = token.map(|v| v.to_string());
                let span = info_span!("control_poll_req", id = %id, method = %method);
                tokio::spawn(
                    async move {
                        let out = match rpc.dispatch(&method, &payload).await {
                            Ok(bytes) => AgentToControlFrame::Resp {
                                id,
                                ok: true,
                                payload_b64: Some(
                                    base64::engine::general_purpose::STANDARD.encode(bytes),
                                ),
                                status_code: None,
                                status_message: None,
                            },
                            Err(status) => AgentToControlFrame::Resp {
                                id,
                                ok: false,
                                payload_b64: None,
                                status_code: Some(status.code() as i32),
                                status_message: Some(status.message().to_string()),
                            },
                        };
                        let _ =
                            post_poll_resp(&client, &resp_url, &node, token.as_deref(), &out).await;
                    }
                    .instrument(span),
                );
            }
            ControlToAgentFrame::Unknown => {}
        }
    }
}

async fn post_poll_resp(
    client: &Client,
    resp_url: &str,
    node: &str,
    token: Option<&str>,
    frame: &AgentToControlFrame,
) -> anyhow::Result<()> {
    let mut req = client.post(resp_url).query(&[("node", node)]).json(frame);
    if let Some(tok) = token {
        req = req.bearer_auth(tok);
    }
    let resp = req.send().await?;
    if resp.status() == StatusCode::NO_CONTENT {
        return Ok(());
    }
    Err(anyhow::anyhow!(
        "control resp bad status {}",
        resp.status().as_u16()
    ))
}

async fn run_once(
    url: &str,
    node: &str,
    token: Option<&str>,
    rpc: &AgentRpc,
) -> anyhow::Result<()> {
    let mut req = url.into_client_request()?;
    if let Some(tok) = token {
        let value = format!("Bearer {tok}");
        req.headers_mut().insert("Authorization", value.parse()?);
    }
    req.headers_mut().insert(
        "User-Agent",
        format!("alloy-agent/{}", env!("CARGO_PKG_VERSION")).parse()?,
    );

    let connect_timeout = ws_connect_timeout();
    let ping_interval = ws_ping_interval();
    let app_keepalive_interval = ws_app_keepalive_interval(ping_interval);
    let idle_timeout = ws_idle_timeout(ping_interval);
    let (ws, _) = tokio::time::timeout(connect_timeout, tokio_tungstenite::connect_async(req))
        .await
        .map_err(|_| {
            anyhow::anyhow!(
                "control ws connect timeout after {}ms",
                connect_timeout.as_millis()
            )
        })??;
    let (mut sink, mut stream) = ws.split();

    let hello = AgentToControlFrame::Hello {
        node: node.to_string(),
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    sink.send(WsMessage::Text(serde_json::to_string(&hello)?.into()))
        .await?;

    let b64 = base64::engine::general_purpose::STANDARD;

    // Don't serialize the whole tunnel behind one long RPC (e.g. downloads/install).
    // Use a single writer task for the WebSocket sink and handle requests concurrently.
    let (out_tx, mut out_rx) = mpsc::channel::<WsMessage>(64);
    let writer = tokio::spawn(async move {
        while let Some(msg) = out_rx.recv().await {
            if sink.send(msg).await.is_err() {
                break;
            }
        }
    });

    let mut ping = tokio::time::interval(ping_interval);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // Skip the immediate first tick; send heartbeats only after the configured interval.
    ping.tick().await;
    let mut app_keepalive = app_keepalive_interval.map(tokio::time::interval);
    if let Some(keepalive) = app_keepalive.as_mut() {
        keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        keepalive.tick().await;
    }
    let mut idle_watch = tokio::time::interval(Duration::from_secs(5));
    idle_watch.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    if idle_timeout.is_some() {
        idle_watch.tick().await;
    }
    let mut last_inbound = tokio::time::Instant::now();

    loop {
        tokio::select! {
            _ = ping.tick() => {
                // Keep-alive frames for flaky proxies / long-RTT links.
                if out_tx.send(WsMessage::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
            _ = async {
                if let Some(keepalive) = app_keepalive.as_mut() {
                    keepalive.tick().await;
                }
            }, if app_keepalive.is_some() => {
                // App-level keepalive survives some intermediaries that ignore WS control frames.
                if out_tx
                    .send(WsMessage::Text("{\"type\":\"keepalive\"}".into()))
                    .await
                    .is_err()
                {
                    break;
                }
            }
            _ = idle_watch.tick(), if idle_timeout.is_some() => {
                let idle_timeout = idle_timeout.expect("idle timeout branch is guarded");
                if last_inbound.elapsed() > idle_timeout {
                    return Err(anyhow::anyhow!(
                        "control ws idle timeout after {}ms",
                        idle_timeout.as_millis()
                    ));
                }
            }
            msg = stream.next() => {
                let Some(msg) = msg else { break };
                let msg = msg?;
                last_inbound = tokio::time::Instant::now();
                match msg {
                    WsMessage::Text(text) => {
                        let frame = serde_json::from_str::<ControlToAgentFrame>(&text)
                            .unwrap_or(ControlToAgentFrame::Unknown);
                        match frame {
                            ControlToAgentFrame::Req {
                                id,
                                method,
                                payload_b64,
                            } => {
                                let payload = match b64.decode(payload_b64.as_bytes()) {
                                    Ok(v) => v,
                                    Err(_) => {
                                        let resp = AgentToControlFrame::Resp {
                                            id,
                                            ok: false,
                                            payload_b64: None,
                                            status_code: Some(
                                                Status::invalid_argument("invalid base64").code() as i32,
                                            ),
                                            status_message: Some("invalid base64 payload".to_string()),
                                        };
                                        let _ = out_tx
                                            .send(WsMessage::Text(serde_json::to_string(&resp)?.into()))
                                            .await;
                                        continue;
                                    }
                                };

                                let rpc = rpc.clone();
                                let out_tx = out_tx.clone();
                                let span = info_span!("control_tunnel_req", id = %id, method = %method);
                                tokio::spawn(
                                    async move {
                                        let out = match rpc.dispatch(&method, &payload).await {
                                            Ok(bytes) => AgentToControlFrame::Resp {
                                                id,
                                                ok: true,
                                                payload_b64: Some(
                                                    base64::engine::general_purpose::STANDARD.encode(bytes),
                                                ),
                                                status_code: None,
                                                status_message: None,
                                            },
                                            Err(status) => AgentToControlFrame::Resp {
                                                id,
                                                ok: false,
                                                payload_b64: None,
                                                status_code: Some(status.code() as i32),
                                                status_message: Some(status.message().to_string()),
                                            },
                                        };

                                        // Best-effort: if the tunnel is gone, just drop the response.
                                        let _ = out_tx
                                            .send(WsMessage::Text(
                                                serde_json::to_string(&out)
                                                    .unwrap_or_else(|_| "{}".to_string())
                                                    .into(),
                                            ))
                                            .await;
                                    }
                                    .instrument(span),
                                );
                            }
                            ControlToAgentFrame::Unknown => {}
                        }
                    }
                    WsMessage::Ping(payload) => {
                        // Keep-alive / intermediaries may send Ping frames.
                        let _ = out_tx.send(WsMessage::Pong(payload)).await;
                    }
                    WsMessage::Pong(_) => {}
                    WsMessage::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    drop(out_tx);
    writer.abort();

    Ok(())
}
