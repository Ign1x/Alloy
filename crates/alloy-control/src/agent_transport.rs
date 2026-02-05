use std::{
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use base64::Engine;
use tokio::sync::oneshot;

use crate::agent_tunnel::{AgentConnection, AgentHub, ControlToAgentFrame, TunnelResponse};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TransportMode {
    Auto,
    TunnelOnly,
    DirectOnly,
}

fn parse_mode(raw: Option<String>) -> TransportMode {
    match raw
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "tunnel" | "reverse" => TransportMode::TunnelOnly,
        "direct" | "grpc" => TransportMode::DirectOnly,
        _ => TransportMode::Auto,
    }
}

fn parse_timeout_ms(raw: Option<String>) -> Duration {
    let ms = raw
        .as_deref()
        .unwrap_or_default()
        .trim()
        .parse::<u64>()
        .ok()
        .unwrap_or(30_000)
        .clamp(1000, 10 * 60_000);
    Duration::from_millis(ms)
}

fn default_node_name() -> String {
    std::env::var("ALLOY_DEFAULT_NODE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "default".to_string())
}

fn agent_endpoint() -> String {
    std::env::var("ALLOY_AGENT_ENDPOINT")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "http://127.0.0.1:50051".to_string())
}

fn code_from_i32(v: i32) -> tonic::Code {
    match v {
        0 => tonic::Code::Ok,
        1 => tonic::Code::Cancelled,
        2 => tonic::Code::Unknown,
        3 => tonic::Code::InvalidArgument,
        4 => tonic::Code::DeadlineExceeded,
        5 => tonic::Code::NotFound,
        6 => tonic::Code::AlreadyExists,
        7 => tonic::Code::PermissionDenied,
        8 => tonic::Code::ResourceExhausted,
        9 => tonic::Code::FailedPrecondition,
        10 => tonic::Code::Aborted,
        11 => tonic::Code::OutOfRange,
        12 => tonic::Code::Unimplemented,
        13 => tonic::Code::Internal,
        14 => tonic::Code::Unavailable,
        15 => tonic::Code::DataLoss,
        16 => tonic::Code::Unauthenticated,
        _ => tonic::Code::Unknown,
    }
}

#[derive(Clone)]
pub struct AgentTransport {
    hub: AgentHub,
    node: String,
    mode: TransportMode,
    timeout: Duration,
    next_id: Arc<AtomicU64>,
    b64: base64::engine::general_purpose::GeneralPurpose,
}

impl AgentTransport {
    pub fn new(hub: AgentHub) -> Self {
        Self {
            hub,
            node: default_node_name(),
            mode: parse_mode(std::env::var("ALLOY_AGENT_TRANSPORT").ok()),
            timeout: parse_timeout_ms(std::env::var("ALLOY_AGENT_TIMEOUT_MS").ok()),
            next_id: Arc::new(AtomicU64::new(1)),
            b64: base64::engine::general_purpose::STANDARD,
        }
    }

    pub async fn connected_nodes(&self) -> Vec<String> {
        self.hub.nodes().await
    }

    async fn pick_tunnel_conn(&self) -> Option<Arc<AgentConnection>> {
        if let Some(c) = self.hub.get(&self.node).await {
            return Some(c);
        }
        let nodes = self.hub.nodes().await;
        if nodes.len() == 1 {
            return self.hub.get(&nodes[0]).await;
        }
        None
    }

    pub async fn call<Req, Res>(&self, method: &'static str, req: Req) -> Result<Res, tonic::Status>
    where
        Req: prost::Message + 'static,
        Res: prost::Message + Default + 'static,
    {
        match self.mode {
            TransportMode::TunnelOnly => self.call_tunnel(method, req).await,
            TransportMode::DirectOnly => self.call_direct(method, req).await,
            TransportMode::Auto => {
                if self.pick_tunnel_conn().await.is_some() {
                    return self.call_tunnel(method, req).await;
                }
                self.call_direct(method, req).await
            }
        }
    }

    async fn call_tunnel<Req, Res>(
        &self,
        method: &'static str,
        req: Req,
    ) -> Result<Res, tonic::Status>
    where
        Req: prost::Message + 'static,
        Res: prost::Message + Default + 'static,
    {
        let Some(conn) = self.pick_tunnel_conn().await else {
            return Err(tonic::Status::unavailable(
                "agent is not connected (no active tunnel)",
            ));
        };

        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        let (tx, rx) = oneshot::channel::<TunnelResponse>();
        conn.pending.lock().await.insert(id.clone(), tx);

        let payload = self.b64.encode(req.encode_to_vec());
        let frame = ControlToAgentFrame::Req {
            id: &id,
            method,
            payload_b64: &payload,
        };

        let text = serde_json::to_string(&frame)
            .map_err(|e| tonic::Status::internal(format!("failed to encode request: {e}")))?;

        if conn
            .tx
            .send(axum::extract::ws::Message::Text(text))
            .await
            .is_err()
        {
            let _ = conn.pending.lock().await.remove(&id);
            return Err(tonic::Status::unavailable("agent connection closed"));
        }

        let resp = match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(v)) => v,
            Ok(Err(_)) => {
                let _ = conn.pending.lock().await.remove(&id);
                return Err(tonic::Status::unavailable("agent connection closed"));
            }
            Err(_) => {
                let _ = conn.pending.lock().await.remove(&id);
                return Err(tonic::Status::deadline_exceeded("agent call timeout"));
            }
        };

        if !resp.ok {
            let code = code_from_i32(resp.status_code.unwrap_or(2));
            return Err(tonic::Status::new(
                code,
                resp.status_message
                    .unwrap_or_else(|| "agent error".to_string()),
            ));
        }

        let payload = resp
            .payload_b64
            .ok_or_else(|| tonic::Status::internal("missing response payload"))?;
        let bytes = self
            .b64
            .decode(payload)
            .map_err(|_| tonic::Status::internal("invalid response base64"))?;

        Res::decode(bytes.as_slice())
            .map_err(|e| tonic::Status::internal(format!("failed to decode response: {e}")))
    }

    async fn call_direct<Req, Res>(
        &self,
        method: &'static str,
        req: Req,
    ) -> Result<Res, tonic::Status>
    where
        Req: prost::Message + 'static,
        Res: prost::Message + Default + 'static,
    {
        let endpoint = agent_endpoint();
        let channel = tonic::transport::Channel::from_shared(endpoint.clone())
            .map_err(|e| tonic::Status::internal(format!("invalid agent endpoint: {e}")))?
            .connect()
            .await
            .map_err(|e| tonic::Status::unavailable(format!("connect failed ({endpoint}): {e}")))?;

        let mut grpc = tonic::client::Grpc::new(channel);
        grpc.ready().await.map_err(|e| {
            tonic::Status::unavailable(format!("agent is not ready ({endpoint}): {e}"))
        })?;
        let mut request = tonic::Request::new(req);
        request.set_timeout(self.timeout);

        let path = tonic::codegen::http::uri::PathAndQuery::from_static(method);
        let codec = tonic::codec::ProstCodec::default();
        let resp = grpc.unary(request, path, codec).await.map_err(|s| s)?;
        Ok(resp.into_inner())
    }
}
