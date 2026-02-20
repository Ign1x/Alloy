use std::time::Duration;

use alloy_db::entities::nodes;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use alloy_proto::agent_v1::HealthCheckRequest;
use alloy_proto::agent_v1::agent_health_service_client::AgentHealthServiceClient;
use tonic::Request;

pub(crate) fn tunnel_disconnect_grace() -> Duration {
    const DEFAULT_MS: u64 = 600_000;
    const MAX_MS: u64 = 900_000;

    let raw = std::env::var("ALLOY_TUNNEL_DISCONNECT_GRACE_MS").ok();
    let ms = raw
        .as_deref()
        .and_then(|v| v.trim().parse::<u64>().ok())
        .unwrap_or(DEFAULT_MS)
        .min(MAX_MS);
    Duration::from_millis(ms)
}

#[derive(Clone)]
pub struct NodeHealthPoller {
    db: std::sync::Arc<DatabaseConnection>,
    hub: crate::agent_tunnel::AgentHub,
}

impl NodeHealthPoller {
    pub fn new(db: std::sync::Arc<DatabaseConnection>, hub: crate::agent_tunnel::AgentHub) -> Self {
        Self { db, hub }
    }

    pub fn spawn(self) {
        tokio::spawn(async move {
            loop {
                self.tick().await;
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });
    }

    async fn tick(&self) {
        let db = &*self.db;
        let tunnel_grace = tunnel_disconnect_grace();

        let rows = match nodes::Entity::find()
            .filter(nodes::Column::Enabled.eq(true))
            .all(db)
            .await
        {
            Ok(v) => v,
            Err(_) => return,
        };

        for n in rows {
            let name = n.name.clone();
            let endpoint = n.endpoint.clone();
            let last_seen_at = n.last_seen_at.map(|dt| dt.with_timezone(&chrono::Utc));
            let tunnel = self.hub.snapshot(&name).await;
            let mut update: nodes::ActiveModel = n.into();
            update.updated_at = Set(chrono::Utc::now().into());

            if let Some(conn) = self.hub.get(&name).await {
                update.last_seen_at = Set(Some(chrono::Utc::now().into()));
                update.agent_version = Set(Some(conn.agent_version.clone()));
                update.last_error = Set(None);
                let _ = update.update(db).await;
                continue;
            }

            // "tunnel://" is a logical endpoint used for reverse-connected nodes.
            // If the node isn't currently tunnel-connected, there's nothing to dial.
            if !endpoint.trim().starts_with("http://") && !endpoint.trim().starts_with("https://") {
                // Avoid noisy flapping when long-haul links reconnect quickly.
                let recently_seen = last_seen_at
                    .and_then(|seen| chrono::Utc::now().signed_duration_since(seen).to_std().ok())
                    .is_some_and(|elapsed| elapsed <= tunnel_grace);
                if recently_seen {
                    let reconnecting_hint = format!(
                        "agent tunnel reconnecting (state={}, reason={}, failures={}, recent_rtt_ms={}, last_success_unix_ms={})",
                        tunnel.state.as_str(),
                        tunnel
                            .reason_code
                            .as_deref()
                            .unwrap_or("tunnel.reconnecting"),
                        tunnel.consecutive_failures,
                        tunnel
                            .recent_rtt_ms
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "unknown".to_string()),
                        tunnel
                            .last_success_unix_ms
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "unknown".to_string())
                    );
                    update.last_error = Set(Some(reconnecting_hint));
                    let _ = update.update(db).await;
                    continue;
                }

                let reason_code = tunnel
                    .reason_code
                    .as_deref()
                    .unwrap_or("tunnel.disconnected");
                let reason_detail = tunnel
                    .reason_detail
                    .as_deref()
                    .unwrap_or("no active tunnel");
                update.last_error = Set(Some(
                    format!(
                        "agent is not connected (state={}, reason={}, detail={}, failures={}, recent_rtt_ms={}, last_success_unix_ms={}; check ALLOY_CONTROL_WS_URL(S) / ALLOY_NODE_TOKEN)",
                        tunnel.state.as_str(),
                        reason_code,
                        reason_detail,
                        tunnel.consecutive_failures,
                        tunnel
                            .recent_rtt_ms
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "unknown".to_string()),
                        tunnel
                            .last_success_unix_ms
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "unknown".to_string())
                    ),
                ));
                let _ = update.update(db).await;
                continue;
            }

            match AgentHealthServiceClient::connect(endpoint.clone()).await {
                Ok(mut client) => match client.check(Request::new(HealthCheckRequest {})).await {
                    Ok(resp) => {
                        let resp = resp.into_inner();
                        update.last_seen_at = Set(Some(chrono::Utc::now().into()));
                        update.agent_version = Set(Some(resp.agent_version));
                        update.last_error = Set(None);
                    }
                    Err(e) => {
                        update.last_error = Set(Some(format!("health check failed: {e}")));
                    }
                },
                Err(e) => {
                    update.last_error = Set(Some(format!("connect failed ({endpoint}): {e}")));
                }
            }

            let _ = update.update(db).await;
        }
    }
}
