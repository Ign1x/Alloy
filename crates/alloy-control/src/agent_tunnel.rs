use std::{collections::HashMap, sync::Arc};

use axum::{
    extract::{
        State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use tokio::sync::{Mutex, RwLock, mpsc, oneshot};
use tracing::Instrument;

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AgentHello {
    pub node: String,
    pub agent_version: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum ControlToAgentFrame<'a> {
    #[serde(rename = "req")]
    Req {
        id: &'a str,
        method: &'a str,
        payload_b64: &'a str,
    },
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(tag = "type")]
pub enum AgentToControlFrame {
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
    #[serde(other)]
    Unknown,
}

#[derive(Debug, Clone)]
pub struct TunnelResponse {
    pub ok: bool,
    pub payload_b64: Option<String>,
    pub status_code: Option<i32>,
    pub status_message: Option<String>,
}

#[derive(Debug)]
pub struct AgentConnection {
    pub node: String,
    pub agent_version: String,
    pub tx: mpsc::Sender<Message>,
    pub pending: Mutex<HashMap<String, oneshot::Sender<TunnelResponse>>>,
}

#[derive(Clone, Default)]
pub struct AgentHub {
    inner: Arc<RwLock<HashMap<String, Arc<AgentConnection>>>>,
}

impl AgentHub {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn get(&self, node: &str) -> Option<Arc<AgentConnection>> {
        self.inner.read().await.get(node).cloned()
    }

    pub async fn nodes(&self) -> Vec<String> {
        self.inner.read().await.keys().cloned().collect()
    }

    pub async fn insert(&self, conn: Arc<AgentConnection>) {
        self.inner.write().await.insert(conn.node.clone(), conn);
    }

    pub async fn remove(&self, node: &str) {
        self.inner.write().await.remove(node);
    }
}

fn configured_agent_token() -> Option<String> {
    std::env::var("ALLOY_AGENT_CONNECT_TOKEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let raw = raw.trim();
    let rest = raw.strip_prefix("Bearer ")?;
    let token = rest.trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

fn auth_ok(headers: &HeaderMap) -> bool {
    let Some(expected) = configured_agent_token() else {
        return true;
    };
    bearer_token(headers).is_some_and(|got| got == expected)
}

pub async fn agent_ws(
    State(hub): State<AgentHub>,
    ws: WebSocketUpgrade,
    headers: HeaderMap,
) -> impl IntoResponse {
    if !auth_ok(&headers) {
        return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
    }

    ws.on_upgrade(|socket| handle_agent_socket(hub, socket))
        .into_response()
}

async fn handle_agent_socket(hub: AgentHub, socket: WebSocket) {
    let span = tracing::info_span!("agent_ws");
    async move {
        let (mut sender, mut receiver) = socket.split();

        let hello = match receiver.next().await {
            Some(Ok(Message::Text(text))) => match serde_json::from_str::<AgentToControlFrame>(&text) {
                Ok(AgentToControlFrame::Hello { node, agent_version }) => AgentHello { node, agent_version },
                _ => {
                    let _ = sender.send(Message::Close(None)).await;
                    return;
                }
            },
            Some(Ok(_)) | Some(Err(_)) | None => {
                let _ = sender.send(Message::Close(None)).await;
                return;
            }
        };

        let node = hello.node.trim().to_string();
        if node.is_empty() {
            let _ = sender.send(Message::Close(None)).await;
            return;
        }

        let (tx, mut rx) = mpsc::channel::<Message>(64);
        let conn = Arc::new(AgentConnection {
            node: node.clone(),
            agent_version: hello.agent_version,
            tx,
            pending: Mutex::new(HashMap::new()),
        });

        hub.insert(conn.clone()).await;

        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sender.send(msg).await.is_err() {
                    break;
                }
            }
        });

        while let Some(msg) = receiver.next().await {
            let Ok(msg) = msg else { break };
            match msg {
                Message::Text(text) => {
                    let Ok(frame) = serde_json::from_str::<AgentToControlFrame>(&text) else {
                        continue;
                    };
                    match frame {
                        AgentToControlFrame::Resp {
                            id,
                            ok,
                            payload_b64,
                            status_code,
                            status_message,
                        } => {
                            let tx = conn.pending.lock().await.remove(&id);
                            if let Some(tx) = tx {
                                let _ = tx.send(TunnelResponse {
                                    ok,
                                    payload_b64,
                                    status_code,
                                    status_message,
                                });
                            }
                        }
                        AgentToControlFrame::Hello { .. } | AgentToControlFrame::Unknown => {}
                    }
                }
                Message::Close(_) => break,
                _ => {}
            }
        }

        hub.remove(&node).await;
        let _ = conn.pending.lock().await.drain();

        writer.abort();
    }
    .instrument(span)
    .await
}

