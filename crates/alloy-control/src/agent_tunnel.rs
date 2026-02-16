use std::{
    collections::{HashMap, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use axum::{
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
};
use futures_util::{SinkExt, StreamExt};
use sea_orm::{ActiveModelTrait, ColumnTrait, EntityTrait, QueryFilter, Set};
use tokio::sync::{Mutex, Notify, RwLock, mpsc, oneshot};
use tracing::Instrument;

use crate::state::AppState;

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
    pub tx: AgentTx,
    pub pending: Mutex<HashMap<String, oneshot::Sender<TunnelResponse>>>,
}

#[derive(Debug)]
pub struct PollMailbox {
    queue: Mutex<VecDeque<String>>,
    notify: Notify,
    last_active_unix_ms: AtomicU64,
}

impl PollMailbox {
    pub fn new() -> Self {
        Self {
            queue: Mutex::new(VecDeque::new()),
            notify: Notify::new(),
            last_active_unix_ms: AtomicU64::new(now_unix_ms()),
        }
    }

    pub fn touch(&self) {
        self.last_active_unix_ms
            .store(now_unix_ms(), Ordering::Relaxed);
    }

    pub fn last_active_unix_ms(&self) -> u64 {
        self.last_active_unix_ms.load(Ordering::Relaxed)
    }

    pub async fn push(&self, text: String) -> Result<(), ()> {
        const MAX_QUEUE: usize = 256;
        let mut q = self.queue.lock().await;
        if q.len() >= MAX_QUEUE {
            return Err(());
        }
        q.push_back(text);
        drop(q);
        self.touch();
        self.notify.notify_one();
        Ok(())
    }

    pub async fn pop_or_wait(&self, wait: Duration) -> Option<String> {
        // Fast path.
        if let Some(v) = self.queue.lock().await.pop_front() {
            self.touch();
            return Some(v);
        }

        // Long-poll with timeout (kept < Cloudflare's proxy timeout).
        let _ = tokio::time::timeout(wait, self.notify.notified()).await;

        let v = self.queue.lock().await.pop_front();
        if v.is_some() {
            self.touch();
        }
        v
    }
}

#[derive(Debug, Clone)]
pub enum AgentTx {
    Ws(mpsc::Sender<Message>),
    Poll(Arc<PollMailbox>),
}

impl AgentTx {
    pub async fn send_text(&self, text: String) -> Result<(), ()> {
        match self {
            AgentTx::Ws(tx) => tx.send(Message::Text(text)).await.map_err(|_| ()),
            AgentTx::Poll(mailbox) => mailbox.push(text).await,
        }
    }

    pub fn poll_last_active_unix_ms(&self) -> Option<u64> {
        match self {
            AgentTx::Poll(mailbox) => Some(mailbox.last_active_unix_ms()),
            _ => None,
        }
    }
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
        let conn = self.inner.read().await.get(node).cloned();
        let Some(conn) = conn else {
            return None;
        };

        if let Some(last_ms) = conn.tx.poll_last_active_unix_ms() {
            let stale_ms = agent_poll_stale_ms();
            let now_ms = now_unix_ms();
            if now_ms.saturating_sub(last_ms) > stale_ms {
                // Consider the node disconnected and drop the poll mailbox.
                let removed = self.inner.write().await.remove(node);
                if let Some(removed) = removed {
                    let _ = removed.pending.lock().await.drain();
                }
                return None;
            }
        }

        Some(conn)
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

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0)
}

fn agent_poll_wait() -> Duration {
    // Keep this comfortably below Cloudflare's ~100s proxy timeout.
    const DEFAULT_MS: u64 = 25_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 90_000;

    let raw = std::env::var("ALLOY_AGENT_POLL_WAIT_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);

    Duration::from_millis(ms)
}

fn agent_poll_stale_ms() -> u64 {
    const DEFAULT_MS: u64 = 60_000;
    const MIN_MS: u64 = 5_000;
    const MAX_MS: u64 = 900_000;

    let raw = std::env::var("ALLOY_AGENT_POLL_STALE_MS").ok();
    raw.as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS)
}

fn configured_agent_token() -> Option<String> {
    std::env::var("ALLOY_AGENT_CONNECT_TOKEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn allow_unsafe_agent_ws_without_token() -> bool {
    matches!(
        std::env::var("ALLOY_ALLOW_UNAUTHENTICATED_AGENT_WS")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn agent_ws_ping_interval() -> Duration {
    const DEFAULT_MS: u64 = 10_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 120_000;

    let raw = std::env::var("ALLOY_AGENT_WS_PING_INTERVAL_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .clamp(MIN_MS, MAX_MS);

    Duration::from_millis(ms)
}

fn agent_ws_app_keepalive_interval(ping_interval: Duration) -> Option<Duration> {
    const DEFAULT_MS: u64 = 15_000;
    const MIN_MS: u64 = 1_000;
    const MAX_MS: u64 = 300_000;

    let raw = std::env::var("ALLOY_AGENT_WS_APP_KEEPALIVE_MS").ok();
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

fn hash_token(raw: &str) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    let raw = headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?;
    let raw = raw.trim();
    let rest = raw.strip_prefix("Bearer ")?;
    let token = rest.trim();
    if token.is_empty() {
        return None;
    }
    Some(token.to_string())
}

#[derive(Debug, Clone, serde::Deserialize)]
struct AgentAuthQuery {
    token: Option<String>,
}

#[derive(Debug, Clone)]
enum WsAuth {
    /// Authorized by a global shared token (ALLOY_AGENT_CONNECT_TOKEN).
    AnyToken,
    /// Authorized by a per-node token; node name must match hello.node.
    NodeToken { node: String },
    /// No token provided; only nodes without a connect token may connect.
    NoToken,
}

async fn authorize(
    db: &alloy_db::sea_orm::DatabaseConnection,
    headers: &HeaderMap,
    query_token: Option<&str>,
) -> Result<WsAuth, StatusCode> {
    let query_token = query_token
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_string());
    let req_token = bearer_token(headers).or(query_token);

    if let Some(expected) = configured_agent_token() {
        if req_token.is_some_and(|got| got == expected) {
            return Ok(WsAuth::AnyToken);
        }
        return Err(StatusCode::UNAUTHORIZED);
    }

    let Some(token) = req_token else {
        if !allow_unsafe_agent_ws_without_token() {
            return Err(StatusCode::UNAUTHORIZED);
        }
        return Ok(WsAuth::NoToken);
    };

    let token_hash = hash_token(&token);
    let row = alloy_db::entities::nodes::Entity::find()
        .filter(alloy_db::entities::nodes::Column::ConnectTokenHash.eq(token_hash))
        .filter(alloy_db::entities::nodes::Column::Enabled.eq(true))
        .one(db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::UNAUTHORIZED)?;

    Ok(WsAuth::NodeToken { node: row.name })
}

pub async fn agent_ws(
    State(state): State<AppState>,
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(q): Query<AgentAuthQuery>,
) -> impl IntoResponse {
    let auth = match authorize(&state.db, &headers, q.token.as_deref()).await {
        Ok(v) => v,
        Err(code) => return (code, "unauthorized").into_response(),
    };

    ws.on_upgrade(move |socket| handle_agent_socket(state, socket, auth))
        .into_response()
}

#[derive(Debug, Clone, serde::Deserialize)]
struct AgentPollQuery {
    node: String,
    agent_version: Option<String>,
    token: Option<String>,
}

pub async fn agent_poll(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AgentPollQuery>,
) -> impl IntoResponse {
    let node = q.node.trim().to_string();
    if node.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing node").into_response();
    }
    let agent_version = q
        .agent_version
        .as_deref()
        .unwrap_or("unknown")
        .trim()
        .to_string();

    let auth = match authorize(&state.db, &headers, q.token.as_deref()).await {
        Ok(v) => v,
        Err(code) => return (code, "unauthorized").into_response(),
    };

    match &auth {
        WsAuth::AnyToken => {}
        WsAuth::NodeToken { node: expected } => {
            if expected != &node {
                return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
            }
        }
        WsAuth::NoToken => {
            // No token: only allow nodes without a connect token configured.
            let existing = alloy_db::entities::nodes::Entity::find()
                .filter(alloy_db::entities::nodes::Column::Name.eq(node.clone()))
                .one(&*state.db)
                .await
                .ok()
                .flatten();

            if let Some(row) = existing {
                if !row.enabled {
                    return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                }
                if row.connect_token_hash.is_some() {
                    return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                }
            }
        }
    }

    ensure_node_row_connected(&state, &node, &agent_version).await;

    // Ensure we have a poll mailbox for this node.
    let mailbox = match state.agent_hub.get(&node).await {
        Some(conn) => match &conn.tx {
            AgentTx::Poll(mailbox) if conn.agent_version == agent_version => mailbox.clone(),
            _ => {
                let mailbox = Arc::new(PollMailbox::new());
                let conn = Arc::new(AgentConnection {
                    node: node.clone(),
                    agent_version: agent_version.clone(),
                    tx: AgentTx::Poll(mailbox.clone()),
                    pending: Mutex::new(HashMap::new()),
                });
                state.agent_hub.insert(conn).await;
                mailbox
            }
        },
        None => {
            let mailbox = Arc::new(PollMailbox::new());
            let conn = Arc::new(AgentConnection {
                node: node.clone(),
                agent_version: agent_version.clone(),
                tx: AgentTx::Poll(mailbox.clone()),
                pending: Mutex::new(HashMap::new()),
            });
            state.agent_hub.insert(conn).await;
            mailbox
        }
    };

    mailbox.touch();

    let wait = agent_poll_wait();
    let next = mailbox.pop_or_wait(wait).await;
    match next {
        None => StatusCode::NO_CONTENT.into_response(),
        Some(text) => (
            StatusCode::OK,
            [(axum::http::header::CONTENT_TYPE, "application/json")],
            text,
        )
            .into_response(),
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
struct AgentRespQuery {
    node: String,
    token: Option<String>,
}

pub async fn agent_resp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(q): Query<AgentRespQuery>,
    axum::extract::Json(frame): axum::extract::Json<AgentToControlFrame>,
) -> impl IntoResponse {
    let node = q.node.trim().to_string();
    if node.is_empty() {
        return (StatusCode::BAD_REQUEST, "missing node").into_response();
    }

    let auth = match authorize(&state.db, &headers, q.token.as_deref()).await {
        Ok(v) => v,
        Err(code) => return (code, "unauthorized").into_response(),
    };
    match &auth {
        WsAuth::AnyToken => {}
        WsAuth::NodeToken { node: expected } => {
            if expected != &node {
                return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
            }
        }
        WsAuth::NoToken => {
            let existing = alloy_db::entities::nodes::Entity::find()
                .filter(alloy_db::entities::nodes::Column::Name.eq(node.clone()))
                .one(&*state.db)
                .await
                .ok()
                .flatten();

            if let Some(row) = existing {
                if !row.enabled {
                    return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                }
                if row.connect_token_hash.is_some() {
                    return (StatusCode::UNAUTHORIZED, "unauthorized").into_response();
                }
            }
        }
    }

    let AgentToControlFrame::Resp {
        id,
        ok,
        payload_b64,
        status_code,
        status_message,
    } = frame
    else {
        return (StatusCode::BAD_REQUEST, "invalid frame").into_response();
    };

    if let Some(conn) = state.agent_hub.get(&node).await {
        if let AgentTx::Poll(mailbox) = &conn.tx {
            mailbox.touch();
        }
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

    StatusCode::NO_CONTENT.into_response()
}

async fn ensure_node_row_connected(state: &AppState, node: &str, agent_version: &str) {
    // Supports "agent discovers panel" bootstrapping: nodes can be created on first contact.
    let now: chrono::DateTime<chrono::Utc> = chrono::Utc::now();
    let existing = alloy_db::entities::nodes::Entity::find()
        .filter(alloy_db::entities::nodes::Column::Name.eq(node.to_string()))
        .one(&*state.db)
        .await
        .ok()
        .flatten();

    if let Some(model) = existing {
        let mut active: alloy_db::entities::nodes::ActiveModel = model.into();
        active.agent_version = Set(Some(agent_version.trim().to_string()));
        active.last_seen_at = Set(Some(now.into()));
        active.last_error = Set(None);
        active.updated_at = Set(now.into());
        let _ = active.update(&*state.db).await;
        return;
    }

    let model = alloy_db::entities::nodes::ActiveModel {
        id: Set(sea_orm::prelude::Uuid::new_v4()),
        name: Set(node.to_string()),
        endpoint: Set(format!("tunnel://{node}")),
        connect_token_hash: Set(None),
        enabled: Set(true),
        last_seen_at: Set(Some(now.into())),
        agent_version: Set(Some(agent_version.trim().to_string())),
        last_error: Set(None),
        created_at: Set(now.into()),
        updated_at: Set(now.into()),
    };
    let _ = alloy_db::entities::nodes::Entity::insert(model)
        .exec(&*state.db)
        .await;
}

async fn handle_agent_socket(state: AppState, socket: WebSocket, auth: WsAuth) {
    let span = tracing::info_span!("agent_ws");
    async move {
        let (mut sender, mut receiver) = socket.split();

        let hello = match receiver.next().await {
            Some(Ok(Message::Text(text))) => {
                match serde_json::from_str::<AgentToControlFrame>(&text) {
                    Ok(AgentToControlFrame::Hello {
                        node,
                        agent_version,
                    }) => AgentHello {
                        node,
                        agent_version,
                    },
                    _ => {
                        let _ = sender.send(Message::Close(None)).await;
                        return;
                    }
                }
            }
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

        match &auth {
            WsAuth::AnyToken => {}
            WsAuth::NodeToken { node: expected } => {
                if expected != &node {
                    let _ = sender.send(Message::Close(None)).await;
                    return;
                }
            }
            WsAuth::NoToken => {
                // No token provided: only allow nodes that do NOT have a connect token configured.
                // This prevents accidentally leaving token-protected nodes open.
                let existing = alloy_db::entities::nodes::Entity::find()
                    .filter(alloy_db::entities::nodes::Column::Name.eq(node.clone()))
                    .one(&*state.db)
                    .await
                    .ok()
                    .flatten();

                if let Some(row) = existing {
                    if !row.enabled {
                        let _ = sender.send(Message::Close(None)).await;
                        return;
                    }
                    if row.connect_token_hash.is_some() {
                        let _ = sender.send(Message::Close(None)).await;
                        return;
                    }
                }
            }
        }

        ensure_node_row_connected(&state, &node, &hello.agent_version).await;

        let (tx, mut rx) = mpsc::channel::<Message>(64);
        let ws_tx = tx.clone();
        let conn = Arc::new(AgentConnection {
            node: node.clone(),
            agent_version: hello.agent_version,
            tx: AgentTx::Ws(tx),
            pending: Mutex::new(HashMap::new()),
        });

        state.agent_hub.insert(conn.clone()).await;

        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sender.send(msg).await.is_err() {
                    break;
                }
            }
        });

        let heartbeat_tx = ws_tx.clone();
        let heartbeat_interval = agent_ws_ping_interval();
        let app_keepalive_interval = agent_ws_app_keepalive_interval(heartbeat_interval);
        let heartbeat = tokio::spawn(async move {
            let mut ping = tokio::time::interval(heartbeat_interval);
            ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            // Skip immediate tick so we only send periodic keepalive frames.
            ping.tick().await;

            let mut app_keepalive = app_keepalive_interval.map(tokio::time::interval);
            if let Some(ticker) = app_keepalive.as_mut() {
                ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                ticker.tick().await;
            }

            loop {
                tokio::select! {
                    _ = ping.tick() => {
                        if heartbeat_tx
                            .send(Message::Ping(Vec::new().into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    _ = async {
                        if let Some(ticker) = app_keepalive.as_mut() {
                            ticker.tick().await;
                        }
                    }, if app_keepalive.is_some() => {
                        // App-level keepalive survives some intermediaries that ignore WS control frames.
                        if heartbeat_tx
                            .send(Message::Text("{\"type\":\"keepalive\"}".into()))
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
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
                Message::Ping(payload) => {
                    let _ = ws_tx.send(Message::Pong(payload)).await;
                }
                Message::Pong(_) => {}
                Message::Close(_) => break,
                _ => {}
            }
        }

        state.agent_hub.remove(&node).await;
        let _ = conn.pending.lock().await.drain();

        heartbeat.abort();
        writer.abort();
    }
    .instrument(span)
    .await
}
