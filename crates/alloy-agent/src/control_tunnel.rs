use std::time::Duration;

use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use prost::Message;
use tokio_tungstenite::tungstenite::{Message as WsMessage, client::IntoClientRequest};
use tracing::{Instrument, info_span};

use alloy_proto::agent_v1::{
    ClearCacheRequest, CreateInstanceRequest, DeleteInstancePreviewRequest, DeleteInstanceRequest,
    GetCacheStatsRequest, GetCapabilitiesRequest, GetInstanceRequest, GetStatusRequest,
    HealthCheckRequest, ListDirRequest, ListInstancesRequest, ListProcessesRequest,
    ListTemplatesRequest, MkdirRequest, ReadFileRequest, RenameRequest, StartFromTemplateRequest,
    StartInstanceRequest, StopInstanceRequest, StopProcessRequest, TailFileRequest, TailLogsRequest,
    UpdateInstanceRequest, WarmTemplateCacheRequest, WriteFileRequest,
    agent_health_service_server::AgentHealthService,
    filesystem_service_server::FilesystemService,
    instance_service_server::InstanceService,
    logs_service_server::LogsService,
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
    fs: crate::filesystem_service::FilesystemApi,
    logs: crate::logs_service::LogsApi,
    process: crate::process_service::ProcessApi,
    instance: crate::instance_service::InstanceApi,
}

impl AgentRpc {
    fn new(manager: ProcessManager) -> Self {
        Self {
            health: crate::health_service::HealthApi,
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

            "/alloy.agent.v1.FilesystemService/GetCapabilities" => {
                let req: GetCapabilitiesRequest = self.decode_req(payload)?;
                let resp = self.fs.get_capabilities(Request::new(req)).await?.into_inner();
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
                let resp = self.process.list_templates(Request::new(req)).await?.into_inner();
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
                let resp = self.process.clear_cache(Request::new(req)).await?.into_inner();
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
                let resp = self.process.get_status(Request::new(req)).await?.into_inner();
                Ok(resp.encode_to_vec())
            }
            "/alloy.agent.v1.ProcessService/TailLogs" => {
                let req: TailLogsRequest = self.decode_req(payload)?;
                let resp = self.process.tail_logs(Request::new(req)).await?.into_inner();
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
    let Some(url) = std::env::var("ALLOY_CONTROL_WS_URL").ok().and_then(|v| parse_ws_url(&v)) else {
        return;
    };

    let node = node_name();
    let token = node_token();
    let rpc = AgentRpc::new(manager);

    tokio::spawn(async move {
        let span = info_span!("control_tunnel", node = %node, url = %url);
        async move {
            let mut backoff = Duration::from_millis(500);
            loop {
                let res = run_once(&url, &node, token.as_deref(), &rpc).await;
                match res {
                    Ok(()) => {
                        // Clean close; reconnect with a small delay.
                        backoff = Duration::from_millis(500);
                    }
                    Err(e) => {
                        tracing::warn!(error = %e, "control tunnel disconnected");
                        backoff = (backoff * 2).min(Duration::from_secs(30));
                    }
                }
                tokio::time::sleep(backoff).await;
            }
        }
        .instrument(span)
        .await;
    });
}

async fn run_once(url: &str, node: &str, token: Option<&str>, rpc: &AgentRpc) -> anyhow::Result<()> {
    let mut req = url.into_client_request()?;
    if let Some(tok) = token {
        let value = format!("Bearer {tok}");
        req.headers_mut().insert("Authorization", value.parse()?);
    }

    let (ws, _) = tokio_tungstenite::connect_async(req).await?;
    let (mut sink, mut stream) = ws.split();

    let hello = AgentToControlFrame::Hello {
        node: node.to_string(),
        agent_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    sink.send(WsMessage::Text(serde_json::to_string(&hello)?.into()))
        .await?;

    let b64 = base64::engine::general_purpose::STANDARD;

    while let Some(msg) = stream.next().await {
        let msg = msg?;
        match msg {
            WsMessage::Text(text) => {
                let frame = serde_json::from_str::<ControlToAgentFrame>(&text).unwrap_or(ControlToAgentFrame::Unknown);
                match frame {
                    ControlToAgentFrame::Req { id, method, payload_b64 } => {
                        let payload = match b64.decode(payload_b64.as_bytes()) {
                            Ok(v) => v,
                            Err(_) => {
                                let resp = AgentToControlFrame::Resp {
                                    id,
                                    ok: false,
                                    payload_b64: None,
                                    status_code: Some(Status::invalid_argument("invalid base64").code() as i32),
                                    status_message: Some("invalid base64 payload".to_string()),
                                };
                                sink.send(WsMessage::Text(serde_json::to_string(&resp)?.into())).await?;
                                continue;
                            }
                        };

                        let out = match rpc.dispatch(&method, &payload).await {
                            Ok(bytes) => AgentToControlFrame::Resp {
                                id,
                                ok: true,
                                payload_b64: Some(b64.encode(bytes)),
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
                        sink.send(WsMessage::Text(serde_json::to_string(&out)?.into())).await?;
                    }
                    ControlToAgentFrame::Unknown => {}
                }
            }
            WsMessage::Close(_) => break,
            _ => {}
        }
    }

    Ok(())
}
