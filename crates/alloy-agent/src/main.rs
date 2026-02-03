use std::net::SocketAddr;

use alloy_proto::agent_v1::agent_health_service_server::{
    AgentHealthService, AgentHealthServiceServer,
};
use alloy_proto::agent_v1::{HealthCheckRequest, HealthCheckResponse};
use tonic::{Request, Response, Status, transport::Server};

#[cfg(target_os = "linux")]
#[derive(Debug, serde::Deserialize)]
struct RunJsonForCleanup {
    pid: Option<u32>,
    pgid: Option<i32>,
    exec: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    template_id: Option<String>,
}

#[cfg(target_os = "linux")]
async fn cleanup_orphan_processes() {
    use std::path::{Path, PathBuf};

    fn canonicalize_best_effort(p: &Path) -> PathBuf {
        std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
    }

    fn parse_cmdline(bytes: Vec<u8>) -> Vec<String> {
        bytes
            .split(|b| *b == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf8_lossy(s).to_string())
            .collect()
    }

    fn cmdline_contains_all(cmdline: &[String], args: &[String]) -> bool {
        args.iter().all(|a| cmdline.iter().any(|c| c == a))
    }

    let data_root = crate::minecraft::data_root();
    let bases = [data_root.join("instances"), data_root.join("processes")];

    for base in bases {
        let mut rd = match tokio::fs::read_dir(&base).await {
            Ok(v) => v,
            Err(_) => continue,
        };

        while let Ok(Some(de)) = rd.next_entry().await {
            let path = de.path();
            let run_path = path.join("run.json");
            let raw = match tokio::fs::read(&run_path).await {
                Ok(v) => v,
                Err(_) => continue,
            };

            let run = match serde_json::from_slice::<RunJsonForCleanup>(&raw) {
                Ok(v) => v,
                Err(_) => continue,
            };

            let Some(pid) = run.pid else { continue };
            let proc_dir = PathBuf::from("/proc").join(pid.to_string());
            if !proc_dir.exists() {
                continue;
            }

            let Some(cwd_str) = run.cwd.as_deref() else {
                continue;
            };
            let run_cwd = canonicalize_best_effort(Path::new(cwd_str));
            let proc_cwd = match std::fs::read_link(proc_dir.join("cwd")) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if canonicalize_best_effort(&proc_cwd) != run_cwd {
                continue;
            }

            let cmdline = std::fs::read(proc_dir.join("cmdline"))
                .ok()
                .map(parse_cmdline)
                .unwrap_or_default();
            let args = run.args.as_deref().unwrap_or(&[]);
            if !args.is_empty() && !cmdline_contains_all(&cmdline, args) {
                continue;
            }

            if let Some(exec) = run.exec.as_deref()
                && Path::new(exec).is_absolute()
            {
                let exe = match std::fs::read_link(proc_dir.join("exe")) {
                    Ok(p) => p,
                    Err(_) => continue,
                };
                if canonicalize_best_effort(&exe) != canonicalize_best_effort(Path::new(exec)) {
                    continue;
                }
            }

            let pgid = run.pgid.unwrap_or(pid as i32);
            let label = run
                .template_id
                .clone()
                .unwrap_or_else(|| "unknown".to_string());
            tracing::warn!(pid, pgid, template_id = %label, "found orphaned child process; terminating");

            unsafe {
                libc::kill(-pgid, libc::SIGTERM);
            }

            let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(2);
            while tokio::time::Instant::now() < deadline {
                if !proc_dir.exists() {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }

            if proc_dir.exists() {
                tracing::warn!(pid, pgid, template_id = %label, "orphan still alive; sending SIGKILL");
                unsafe {
                    libc::kill(-pgid, libc::SIGKILL);
                }
            }
        }
    }
}

#[cfg(not(target_os = "linux"))]
async fn cleanup_orphan_processes() {}

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
            s.f_bsize.saturating_mul(s.f_bavail)
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
    cleanup_orphan_processes().await;

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
