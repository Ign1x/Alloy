use std::net::SocketAddr;

use alloy_proto::agent_v1::agent_health_service_server::{
    AgentHealthService, AgentHealthServiceServer,
};
use alloy_proto::agent_v1::{HealthCheckRequest, HealthCheckResponse};
use tonic::{Request, Response, Status, transport::Server};

mod filesystem_service;
mod instance_service;
mod logs_service;
mod minecraft;
mod minecraft_download;
mod port_alloc;
mod process_manager;
mod process_service;
mod templates;
mod terraria;
mod terraria_download;

#[derive(Debug, Default)]
struct AgentHealth;

#[tonic::async_trait]
impl AgentHealthService for AgentHealth {
    async fn check(
        &self,
        _request: Request<HealthCheckRequest>,
    ) -> Result<Response<HealthCheckResponse>, Status> {
        let data_root = crate::minecraft::data_root();
        let data_root_str = data_root.display().to_string();

        let writable = std::fs::create_dir_all(&data_root)
            .and_then(|_| {
                let probe = data_root.join(".alloy_write_probe");
                std::fs::write(&probe, b"ok\n").and_then(|_| std::fs::remove_file(probe))
            })
            .is_ok();

        #[cfg(unix)]
        fn free_bytes(p: &std::path::Path) -> u64 {
            use std::ffi::CString;
            use std::os::unix::ffi::OsStrExt;
            let c = match CString::new(p.as_os_str().as_bytes()) {
                Ok(v) => v,
                Err(_) => return 0,
            };
            let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
            let rc = unsafe { libc::statvfs(c.as_ptr(), &mut s) };
            if rc != 0 {
                return 0;
            }
            (s.f_bsize as u64).saturating_mul(s.f_bavail as u64)
        }

        #[cfg(not(unix))]
        fn free_bytes(_p: &std::path::Path) -> u64 {
            0
        }

        let reply = HealthCheckResponse {
            status: "SERVING".to_string(),
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            data_root: data_root_str,
            data_root_writable: writable,
            data_root_free_bytes: free_bytes(&data_root),
        };
        Ok(Response::new(reply))
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // Ensure the data root exists early so health checks and instance creation are stable.
    std::fs::create_dir_all(crate::minecraft::data_root())?;

    let addr: SocketAddr = ([0, 0, 0, 0], 50051).into();
    tracing::info!(%addr, "alloy-agent gRPC listening");

    let manager = process_manager::ProcessManager::default();

    Server::builder()
        .add_service(AgentHealthServiceServer::new(AgentHealth))
        .add_service(filesystem_service::server())
        .add_service(logs_service::server())
        .add_service(process_service::server(manager.clone()))
        .add_service(instance_service::server(manager))
        .serve(addr)
        .await?;

    Ok(())
}
