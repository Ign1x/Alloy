use alloy_proto::agent_v1::agent_health_service_server::{
    AgentHealthService, AgentHealthServiceServer,
};
use alloy_proto::agent_v1::{HealthCheckRequest, HealthCheckResponse, PortAvailability};
use tonic::{Request, Response, Status};

#[derive(Debug, Default, Clone)]
pub struct HealthApi;

#[tonic::async_trait]
impl AgentHealthService for HealthApi {
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

        fn parse_health_ports() -> Vec<u16> {
            let raw = std::env::var("ALLOY_HEALTH_CHECK_PORTS")
                .unwrap_or_else(|_| "25565,7777".to_string());
            let mut out = Vec::new();
            for part in raw.split(',') {
                let p = part.trim();
                if p.is_empty() {
                    continue;
                }
                if let Ok(v) = p.parse::<u16>() {
                    out.push(v);
                }
            }
            out.sort_unstable();
            out.dedup();
            out
        }

        fn check_tcp_port(port: u16) -> PortAvailability {
            use std::io::ErrorKind;
            use std::net::TcpListener;

            match TcpListener::bind(("0.0.0.0", port)) {
                Ok(l) => {
                    l.set_nonblocking(true).ok();
                    PortAvailability {
                        port: port as u32,
                        available: true,
                        error: String::new(),
                    }
                }
                Err(e) if e.kind() == ErrorKind::AddrInUse => PortAvailability {
                    port: port as u32,
                    available: false,
                    error: "addr_in_use".to_string(),
                },
                Err(e) => PortAvailability {
                    port: port as u32,
                    available: false,
                    error: format!("{e}"),
                },
            }
        }

        let ports = parse_health_ports()
            .into_iter()
            .map(check_tcp_port)
            .collect();

        let reply = HealthCheckResponse {
            status: "SERVING".to_string(),
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            data_root: data_root_str,
            data_root_writable: writable,
            data_root_free_bytes: free_bytes(&data_root),
            ports,
        };
        Ok(Response::new(reply))
    }
}

pub fn server() -> AgentHealthServiceServer<HealthApi> {
    AgentHealthServiceServer::new(HealthApi)
}
