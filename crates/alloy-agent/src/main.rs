use std::net::SocketAddr;

use tonic::transport::Server;
use tracing_subscriber::prelude::*;

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

mod error_payload;
mod health_service;
mod filesystem_service;
mod instance_service;
mod logs_service;
mod minecraft;
mod minecraft_download;
mod port_alloc;
mod process_manager;
mod process_service;
mod control_tunnel;
mod templates;
mod terraria;
mod terraria_download;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Ensure the data root exists early so health checks and instance creation are stable.
    std::fs::create_dir_all(crate::minecraft::data_root())?;

    // Persist agent logs under data root and keep stdout logs for docker/dev.
    let log_dir = crate::minecraft::data_root().join("logs");
    std::fs::create_dir_all(&log_dir)?;
    let file_appender = tracing_appender::rolling::daily(&log_dir, "agent.log");
    let (file_writer, file_guard) = tracing_appender::non_blocking(file_appender);

    let filter = tracing_subscriber::EnvFilter::from_default_env();
    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(std::io::stdout)
                .with_ansi(true),
        )
        .with(
            tracing_subscriber::fmt::layer()
                .with_writer(file_writer)
                .with_ansi(false),
        )
        .init();
    let _file_guard = file_guard;

    cleanup_orphan_processes().await;

    let addr: SocketAddr = ([0, 0, 0, 0], 50051).into();
    tracing::info!(%addr, "alloy-agent gRPC listening");

    let manager = process_manager::ProcessManager::default();

    control_tunnel::spawn(manager.clone());

    Server::builder()
        .add_service(health_service::server())
        .add_service(filesystem_service::server())
        .add_service(logs_service::server())
        .add_service(process_service::server(manager.clone()))
        .add_service(instance_service::server(manager))
        .serve(addr)
        .await?;

    Ok(())
}
