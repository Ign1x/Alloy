use std::net::SocketAddr;

use alloy_proto::agent_v1::agent_health_service_server::{
    AgentHealthService, AgentHealthServiceServer,
};
use alloy_proto::agent_v1::{HealthCheckRequest, HealthCheckResponse};
use tonic::{Request, Response, Status, transport::Server};

mod process_manager;
mod process_service;
mod templates;

#[derive(Debug, Default)]
struct AgentHealth;

#[tonic::async_trait]
impl AgentHealthService for AgentHealth {
    async fn check(
        &self,
        _request: Request<HealthCheckRequest>,
    ) -> Result<Response<HealthCheckResponse>, Status> {
        let reply = HealthCheckResponse {
            status: "SERVING".to_string(),
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        Ok(Response::new(reply))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let addr: SocketAddr = ([0, 0, 0, 0], 50051).into();
    tracing::info!(%addr, "alloy-agent gRPC listening");

    let manager = process_manager::ProcessManager::default();

    Server::builder()
        .add_service(AgentHealthServiceServer::new(AgentHealth))
        .add_service(process_service::server(manager))
        .serve(addr)
        .await?;

    Ok(())
}
