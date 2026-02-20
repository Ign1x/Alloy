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
use tracing::{Instrument, debug, info, warn};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelLinkKind {
    Ws,
    Poll,
}

impl TunnelLinkKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ws => "ws",
            Self::Poll => "poll",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelState {
    Connected,
    Stale,
    Reconnecting,
    Disconnected,
}

impl TunnelState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connected => "connected",
            Self::Stale => "stale",
            Self::Reconnecting => "reconnecting",
            Self::Disconnected => "disconnected",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TunnelReasonCode {
    WsConnected,
    PollConnected,
    WsReadClosed,
    WsReadError,
    WsSendFailed,
    WsHeartbeatSendFailed,
    PollStaleTimeout,
    PollMailboxFull,
    PollHeartbeat,
    PollDelivery,
    WsDelivery,
    RequestTimeout,
    Reconnecting,
    Disconnected,
    PendingDropped,
    ReplacedByNewConnection,
}

impl TunnelReasonCode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WsConnected => "tunnel.ws.connected",
            Self::PollConnected => "tunnel.poll.connected",
            Self::WsReadClosed => "tunnel.ws.read_closed",
            Self::WsReadError => "tunnel.ws.read_error",
            Self::WsSendFailed => "tunnel.ws.send_failed",
            Self::WsHeartbeatSendFailed => "tunnel.ws.heartbeat_send_failed",
            Self::PollStaleTimeout => "tunnel.poll.stale_timeout",
            Self::PollMailboxFull => "tunnel.poll.mailbox_full",
            Self::PollHeartbeat => "tunnel.poll.heartbeat",
            Self::PollDelivery => "tunnel.poll.delivery",
            Self::WsDelivery => "tunnel.ws.delivery",
            Self::RequestTimeout => "tunnel.request.timeout",
            Self::Reconnecting => "tunnel.reconnecting",
            Self::Disconnected => "tunnel.disconnected",
            Self::PendingDropped => "tunnel.pending.dropped",
            Self::ReplacedByNewConnection => "tunnel.replaced_by_new_connection",
        }
    }
}

#[derive(Debug, Clone)]
pub struct TunnelSnapshot {
    pub state: TunnelState,
    pub link: Option<TunnelLinkKind>,
    pub reason_code: Option<String>,
    pub reason_detail: Option<String>,
    pub updated_at_unix_ms: u64,
    pub recent_rtt_ms: Option<u64>,
    pub consecutive_failures: u32,
    pub last_success_unix_ms: Option<u64>,
}

impl Default for TunnelSnapshot {
    fn default() -> Self {
        Self {
            state: TunnelState::Disconnected,
            link: None,
            reason_code: None,
            reason_detail: None,
            updated_at_unix_ms: now_unix_ms(),
            recent_rtt_ms: None,
            consecutive_failures: 0,
            last_success_unix_ms: None,
        }
    }
}

fn is_valid_tunnel_transition(from: TunnelState, to: TunnelState) -> bool {
    match from {
        TunnelState::Connected => matches!(
            to,
            TunnelState::Connected
                | TunnelState::Stale
                | TunnelState::Reconnecting
                | TunnelState::Disconnected
        ),
        TunnelState::Stale => matches!(
            to,
            TunnelState::Stale
                | TunnelState::Reconnecting
                | TunnelState::Disconnected
                | TunnelState::Connected
        ),
        TunnelState::Reconnecting => matches!(
            to,
            TunnelState::Reconnecting
                | TunnelState::Connected
                | TunnelState::Disconnected
                | TunnelState::Stale
        ),
        TunnelState::Disconnected => {
            matches!(to, TunnelState::Disconnected | TunnelState::Reconnecting | TunnelState::Connected)
        }
    }
}

#[derive(Debug)]
pub struct AgentConnection {
    pub node: String,
    pub agent_version: String,
    pub tx: AgentTx,
    pub pending: Mutex<HashMap<String, oneshot::Sender<TunnelResponse>>>,
}

impl AgentConnection {
    fn link_kind(&self) -> TunnelLinkKind {
        match &self.tx {
            AgentTx::Ws(_) => TunnelLinkKind::Ws,
            AgentTx::Poll(_) => TunnelLinkKind::Poll,
        }
    }
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

    pub async fn len(&self) -> usize {
        self.queue.lock().await.len()
    }

    pub async fn drain(&self) -> usize {
        let mut q = self.queue.lock().await;
        let dropped = q.len();
        q.clear();
        dropped
    }
}

fn connected_reason_code(link: TunnelLinkKind) -> TunnelReasonCode {
    match link {
        TunnelLinkKind::Ws => TunnelReasonCode::WsConnected,
        TunnelLinkKind::Poll => TunnelReasonCode::PollConnected,
    }
}

async fn drain_pending_requests_with_logs(
    node: &str,
    pending: &Mutex<HashMap<String, oneshot::Sender<TunnelResponse>>>,
    reason: TunnelReasonCode,
    reason_detail: &str,
) -> usize {
    let mut guard = pending.lock().await;
    let count = guard.len();
    if count == 0 {
        debug!(
            node,
            reason_code = reason.as_str(),
            reason_detail,
            "pending cleanup no-op"
        );
        return 0;
    }

    let sample_ids: Vec<String> = guard.keys().take(5).cloned().collect();
    info!(
        node,
        reason_code = reason.as_str(),
        reason_detail,
        pending_count = count,
        "draining pending tunnel requests"
    );
    warn!(
        node,
        reason_code = reason.as_str(),
        reason_detail,
        pending_count = count,
        "pending tunnel requests dropped"
    );
    debug!(
        node,
        reason_code = reason.as_str(),
        reason_detail,
        sample_request_ids = ?sample_ids,
        "pending cleanup sample ids"
    );

    guard.clear();
    count
}

async fn cleanup_poll_mailbox_with_logs(
    node: &str,
    mailbox: &PollMailbox,
    reason: TunnelReasonCode,
    reason_detail: &str,
) -> usize {
    let queued = mailbox.len().await;
    info!(
        node,
        reason_code = reason.as_str(),
        reason_detail,
        queued_messages = queued,
        "cleaning poll mailbox"
    );
    if queued > 0 {
        warn!(
            node,
            reason_code = reason.as_str(),
            reason_detail,
            queued_messages = queued,
            "dropping queued poll mailbox messages"
        );
    }

    let dropped = mailbox.drain().await;
    debug!(
        node,
        reason_code = reason.as_str(),
        reason_detail,
        dropped_messages = dropped,
        "poll mailbox cleanup finished"
    );
    dropped
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
    snapshots: Arc<RwLock<HashMap<String, TunnelSnapshot>>>,
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
                let stale_for_ms = now_ms.saturating_sub(last_ms);
                self.record_tunnel_event(
                    node,
                    TunnelState::Stale,
                    Some(TunnelLinkKind::Poll),
                    TunnelReasonCode::PollStaleTimeout,
                    Some(format!(
                        "poll stale timeout: stale_for_ms={stale_for_ms} stale_window_ms={stale_ms}"
                    )),
                    None,
                    false,
                    true,
                )
                .await;
                self.record_tunnel_event(
                    node,
                    TunnelState::Reconnecting,
                    Some(TunnelLinkKind::Poll),
                    TunnelReasonCode::Reconnecting,
                    Some("removing stale poll mailbox".to_string()),
                    None,
                    false,
                    false,
                )
                .await;

                if let AgentTx::Poll(mailbox) = &conn.tx {
                    let _ = cleanup_poll_mailbox_with_logs(
                        node,
                        mailbox,
                        TunnelReasonCode::PollStaleTimeout,
                        "stale poll mailbox",
                    )
                    .await;
                }

                let removed = self.remove_if_same(node, &conn).await;
                let dropped = drain_pending_requests_with_logs(
                    node,
                    &conn.pending,
                    TunnelReasonCode::PendingDropped,
                    "stale poll cleanup",
                )
                .await;
                if dropped > 0 {
                    self.record_tunnel_event(
                        node,
                        TunnelState::Reconnecting,
                        Some(TunnelLinkKind::Poll),
                        TunnelReasonCode::PendingDropped,
                        Some(format!("dropped_pending_requests={dropped}")),
                        None,
                        false,
                        true,
                    )
                    .await;
                }
                if removed {
                    self.record_tunnel_event(
                        node,
                        TunnelState::Disconnected,
                        Some(TunnelLinkKind::Poll),
                        TunnelReasonCode::Disconnected,
                        Some("stale poll tunnel removed".to_string()),
                        None,
                        false,
                        false,
                    )
                    .await;
                }
                return None;
            }
        }

        Some(conn)
    }

    pub async fn snapshot(&self, node: &str) -> TunnelSnapshot {
        self.snapshots
            .read()
            .await
            .get(node)
            .cloned()
            .unwrap_or_default()
    }

    pub async fn nodes(&self) -> Vec<String> {
        self.inner.read().await.keys().cloned().collect()
    }

    pub async fn insert(&self, conn: Arc<AgentConnection>) {
        let _ = self.insert_connection(conn).await;
    }

    pub async fn insert_replace(&self, conn: Arc<AgentConnection>) -> Option<Arc<AgentConnection>> {
        self.insert_connection(conn).await
    }

    pub async fn remove_if_same(&self, node: &str, conn: &Arc<AgentConnection>) -> bool {
        let mut inner = self.inner.write().await;
        let Some(current) = inner.get(node) else {
            return false;
        };
        if Arc::ptr_eq(current, conn) {
            inner.remove(node);
            return true;
        }
        false
    }

    pub async fn remove(&self, node: &str) {
        let conn = self.inner.write().await.remove(node);
        self.snapshots.write().await.remove(node);
        if let Some(conn) = conn {
            if let AgentTx::Poll(mailbox) = &conn.tx {
                let _ = cleanup_poll_mailbox_with_logs(
                    node,
                    mailbox,
                    TunnelReasonCode::Disconnected,
                    "explicit hub remove",
                )
                .await;
            }
            let _ = drain_pending_requests_with_logs(
                node,
                &conn.pending,
                TunnelReasonCode::PendingDropped,
                "explicit hub remove",
            )
            .await;
        }
    }

    async fn insert_connection(&self, conn: Arc<AgentConnection>) -> Option<Arc<AgentConnection>> {
        let node = conn.node.clone();
        let new_link = conn.link_kind();
        let replaced = self.inner.write().await.insert(node.clone(), conn.clone());

        if let Some(old_conn) = replaced.as_ref() {
            let old_link = old_conn.link_kind();
            self.record_tunnel_event(
                &node,
                TunnelState::Reconnecting,
                Some(old_link),
                TunnelReasonCode::ReplacedByNewConnection,
                Some(format!(
                    "old_link={} new_link={}",
                    old_link.as_str(),
                    new_link.as_str()
                )),
                None,
                false,
                true,
            )
            .await;

            if let AgentTx::Poll(mailbox) = &old_conn.tx {
                let _ = cleanup_poll_mailbox_with_logs(
                    &node,
                    mailbox,
                    TunnelReasonCode::ReplacedByNewConnection,
                    "connection replaced",
                )
                .await;
            }

            let dropped = drain_pending_requests_with_logs(
                &node,
                &old_conn.pending,
                TunnelReasonCode::PendingDropped,
                "connection replaced",
            )
            .await;
            if dropped > 0 {
                self.record_tunnel_event(
                    &node,
                    TunnelState::Reconnecting,
                    Some(old_link),
                    TunnelReasonCode::PendingDropped,
                    Some(format!("dropped_pending_requests={dropped}")),
                    None,
                    false,
                    true,
                )
                .await;
            }

            self.record_tunnel_event(
                &node,
                TunnelState::Disconnected,
                Some(old_link),
                TunnelReasonCode::Disconnected,
                Some("previous tunnel connection replaced".to_string()),
                None,
                false,
                false,
            )
            .await;
        }

        self.record_tunnel_event(
            &node,
            TunnelState::Connected,
            Some(new_link),
            connected_reason_code(new_link),
            Some(format!("agent_version={}", conn.agent_version.trim())),
            None,
            true,
            false,
        )
        .await;

        replaced
    }

    async fn record_tunnel_event(
        &self,
        node: &str,
        next_state: TunnelState,
        link: Option<TunnelLinkKind>,
        reason: TunnelReasonCode,
        reason_detail: Option<String>,
        recent_rtt_ms: Option<u64>,
        mark_success: bool,
        mark_failure: bool,
    ) {
        let mut snapshots = self.snapshots.write().await;
        let snapshot = snapshots.entry(node.to_string()).or_default();
        let from_state = snapshot.state;
        if !is_valid_tunnel_transition(from_state, next_state) {
            warn!(
                node,
                from_state = from_state.as_str(),
                to_state = next_state.as_str(),
                reason_code = reason.as_str(),
                "invalid tunnel state transition ignored"
            );
            return;
        }

        snapshot.state = next_state;
        if let Some(link) = link {
            snapshot.link = Some(link);
        }
        snapshot.reason_code = Some(reason.as_str().to_string());
        snapshot.reason_detail = reason_detail;
        let now_ms = now_unix_ms();
        snapshot.updated_at_unix_ms = now_ms;
        if let Some(rtt_ms) = recent_rtt_ms {
            snapshot.recent_rtt_ms = Some(rtt_ms);
        }

        if mark_failure {
            snapshot.consecutive_failures = snapshot.consecutive_failures.saturating_add(1);
        }
        if mark_success {
            snapshot.consecutive_failures = 0;
            snapshot.last_success_unix_ms = Some(now_ms);
        }
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
    const DEFAULT_MS: u64 = 360_000;
    const MIN_MS: u64 = 15_000;
    const MAX_MS: u64 = 900_000;

    let recommended = {
        let wait_ms = agent_poll_wait().as_millis().min(u64::MAX as u128) as u64;
        wait_ms.saturating_mul(3).saturating_add(15_000)
    };

    let raw = std::env::var("ALLOY_AGENT_POLL_STALE_MS").ok();
    raw.as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .filter(|v| *v > 0)
        .unwrap_or(DEFAULT_MS)
        .max(recommended)
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
pub struct AgentAuthQuery {
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
pub struct AgentPollQuery {
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

    if let Some(conn) = state.agent_hub.get(&node).await {
        state
            .agent_hub
            .record_tunnel_event(
                &node,
                TunnelState::Connected,
                Some(conn.link_kind()),
                connected_reason_code(conn.link_kind()),
                Some("poll request observed".to_string()),
                None,
                true,
                false,
            )
            .await;
    }

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
    let started_at_ms = now_unix_ms();
    let next = mailbox.pop_or_wait(wait).await;
    match next {
        None => {
            state
                .agent_hub
                .record_tunnel_event(
                    &node,
                    TunnelState::Connected,
                    Some(TunnelLinkKind::Poll),
                    TunnelReasonCode::PollHeartbeat,
                    Some(format!("poll heartbeat timeout_ms={}", wait.as_millis())),
                    None,
                    true,
                    false,
                )
                .await;
            StatusCode::NO_CONTENT.into_response()
        }
        Some(text) => {
            let rtt_ms = now_unix_ms().saturating_sub(started_at_ms);
            state
                .agent_hub
                .record_tunnel_event(
                    &node,
                    TunnelState::Connected,
                    Some(TunnelLinkKind::Poll),
                    TunnelReasonCode::PollDelivery,
                    Some(format!("poll delivery rtt_ms={rtt_ms}")),
                    Some(rtt_ms),
                    true,
                    false,
                )
                .await;
            (
                StatusCode::OK,
                [(axum::http::header::CONTENT_TYPE, "application/json")],
                text,
            )
                .into_response()
        }
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct AgentRespQuery {
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
            state
                .agent_hub
                .record_tunnel_event(
                    &node,
                    TunnelState::Connected,
                    Some(TunnelLinkKind::Poll),
                    TunnelReasonCode::PollDelivery,
                    Some("poll response delivered".to_string()),
                    None,
                    true,
                    false,
                )
                .await;
        } else {
            state
                .agent_hub
                .record_tunnel_event(
                    &node,
                    TunnelState::Reconnecting,
                    Some(TunnelLinkKind::Poll),
                    TunnelReasonCode::RequestTimeout,
                    Some(format!("late poll response id={id}")),
                    None,
                    false,
                    true,
                )
                .await;
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

        let _ = state.agent_hub.insert_replace(conn.clone()).await;

        state
            .agent_hub
            .record_tunnel_event(
                &node,
                TunnelState::Connected,
                Some(TunnelLinkKind::Ws),
                TunnelReasonCode::WsConnected,
                Some("websocket handshake completed".to_string()),
                None,
                true,
                false,
            )
            .await;

        let writer_node = node.clone();
        let writer_hub = state.agent_hub.clone();
        let writer = tokio::spawn(async move {
            while let Some(msg) = rx.recv().await {
                if sender.send(msg).await.is_err() {
                    writer_hub
                        .record_tunnel_event(
                            &writer_node,
                            TunnelState::Reconnecting,
                            Some(TunnelLinkKind::Ws),
                            TunnelReasonCode::WsSendFailed,
                            Some("websocket writer send failed".to_string()),
                            None,
                            false,
                            true,
                        )
                        .await;
                    break;
                }
            }
        });

        let heartbeat_tx = ws_tx.clone();
        let heartbeat_interval = agent_ws_ping_interval();
        let app_keepalive_interval = agent_ws_app_keepalive_interval(heartbeat_interval);
        let heartbeat_node = node.clone();
        let heartbeat_hub = state.agent_hub.clone();
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
                            heartbeat_hub
                                .record_tunnel_event(
                                    &heartbeat_node,
                                    TunnelState::Reconnecting,
                                    Some(TunnelLinkKind::Ws),
                                    TunnelReasonCode::WsHeartbeatSendFailed,
                                    Some("websocket ping send failed".to_string()),
                                    None,
                                    false,
                                    true,
                                )
                                .await;
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
                            heartbeat_hub
                                .record_tunnel_event(
                                    &heartbeat_node,
                                    TunnelState::Reconnecting,
                                    Some(TunnelLinkKind::Ws),
                                    TunnelReasonCode::WsHeartbeatSendFailed,
                                    Some("websocket app keepalive send failed".to_string()),
                                    None,
                                    false,
                                    true,
                                )
                                .await;
                            break;
                        }
                    }
                }
            }
        });

        while let Some(msg) = receiver.next().await {
            let Ok(msg) = msg else {
                state
                    .agent_hub
                    .record_tunnel_event(
                        &node,
                        TunnelState::Reconnecting,
                        Some(TunnelLinkKind::Ws),
                        TunnelReasonCode::WsReadError,
                        Some("websocket read error".to_string()),
                        None,
                        false,
                        true,
                    )
                    .await;
                break;
            };
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
                                state
                                    .agent_hub
                                    .record_tunnel_event(
                                        &node,
                                        TunnelState::Connected,
                                        Some(TunnelLinkKind::Ws),
                                        TunnelReasonCode::WsDelivery,
                                        Some("ws response delivered".to_string()),
                                        None,
                                        true,
                                        false,
                                    )
                                    .await;
                            } else {
                                state
                                    .agent_hub
                                    .record_tunnel_event(
                                        &node,
                                        TunnelState::Reconnecting,
                                        Some(TunnelLinkKind::Ws),
                                        TunnelReasonCode::RequestTimeout,
                                        Some(format!("late ws response id={id}")),
                                        None,
                                        false,
                                        true,
                                    )
                                    .await;
                            }
                        }
                        AgentToControlFrame::Hello { .. } | AgentToControlFrame::Unknown => {}
                    }
                }
                Message::Ping(payload) => {
                    let _ = ws_tx.send(Message::Pong(payload)).await;
                }
                Message::Pong(_) => {}
                Message::Close(_) => {
                    state
                        .agent_hub
                        .record_tunnel_event(
                            &node,
                            TunnelState::Reconnecting,
                            Some(TunnelLinkKind::Ws),
                            TunnelReasonCode::WsReadClosed,
                            Some("websocket peer closed".to_string()),
                            None,
                            false,
                            true,
                        )
                        .await;
                    break;
                }
                _ => {}
            }
        }

        let removed = state.agent_hub.remove_if_same(&node, &conn).await;
        let dropped = drain_pending_requests_with_logs(
            &node,
            &conn.pending,
            TunnelReasonCode::PendingDropped,
            "ws connection closed",
        )
        .await;
        if dropped > 0 {
            state
                .agent_hub
                .record_tunnel_event(
                    &node,
                    TunnelState::Reconnecting,
                    Some(TunnelLinkKind::Ws),
                    TunnelReasonCode::PendingDropped,
                    Some(format!("dropped_pending_requests={dropped}")),
                    None,
                    false,
                    true,
                )
                .await;
        }
        if removed {
            state
                .agent_hub
                .record_tunnel_event(
                    &node,
                    TunnelState::Disconnected,
                    Some(TunnelLinkKind::Ws),
                    TunnelReasonCode::Disconnected,
                    Some("ws tunnel removed from hub".to_string()),
                    None,
                    false,
                    false,
                )
                .await;
        }

        heartbeat.abort();
        writer.abort();
    }
    .instrument(span)
    .await
}
