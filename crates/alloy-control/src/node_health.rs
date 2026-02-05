use std::time::Duration;

use alloy_db::entities::nodes;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use alloy_proto::agent_v1::HealthCheckRequest;
use alloy_proto::agent_v1::agent_health_service_client::AgentHealthServiceClient;
use tonic::Request;

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
                update.last_error = Set(Some("agent is not connected".to_string()));
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
