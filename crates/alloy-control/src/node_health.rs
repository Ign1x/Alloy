use std::time::Duration;

use alloy_db::entities::nodes;
use sea_orm::{ActiveModelTrait, ColumnTrait, DatabaseConnection, EntityTrait, QueryFilter, Set};

use alloy_proto::agent_v1::agent_health_service_client::AgentHealthServiceClient;
use alloy_proto::agent_v1::HealthCheckRequest;
use tonic::Request;

#[derive(Clone)]
pub struct NodeHealthPoller {
    db: std::sync::Arc<DatabaseConnection>,
}

impl NodeHealthPoller {
    pub fn new(db: std::sync::Arc<DatabaseConnection>) -> Self {
        Self { db }
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

        let rows = match nodes::Entity::find().filter(nodes::Column::Enabled.eq(true)).all(db).await {
            Ok(v) => v,
            Err(_) => return,
        };

        for n in rows {
            let endpoint = n.endpoint.clone();
            let mut update: nodes::ActiveModel = n.into();
            update.updated_at = Set(chrono::Utc::now().into());

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
