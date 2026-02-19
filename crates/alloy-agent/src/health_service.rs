use alloy_proto::agent_v1::agent_health_service_server::{
    AgentHealthService, AgentHealthServiceServer,
};
use alloy_proto::agent_v1::{HealthCheckRequest, HealthCheckResponse, PortAvailability};
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
use tonic::{Request, Response, Status};

#[derive(Debug, Default, Clone)]
pub struct HealthApi;

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    if ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || ip.is_documentation()
    {
        return false;
    }
    let oct = ip.octets();
    if oct[0] == 100 && (64..=127).contains(&oct[1]) {
        return false;
    }
    if oct[0] == 198 && (oct[1] == 18 || oct[1] == 19) {
        return false;
    }
    true
}

fn scan_interface_ipv4() -> (Option<Ipv4Addr>, Option<Ipv4Addr>) {
    let mut public_ip: Option<Ipv4Addr> = None;
    let mut private_ip: Option<Ipv4Addr> = None;

    let Ok(addrs) = if_addrs::get_if_addrs() else {
        return (None, None);
    };

    for iface in addrs {
        let IpAddr::V4(v4) = iface.ip() else {
            continue;
        };
        if is_public_ipv4(v4) {
            if public_ip.is_none() {
                public_ip = Some(v4);
            }
            continue;
        }
        if v4.is_private() && !v4.is_loopback() && !v4.is_link_local() && private_ip.is_none() {
            private_ip = Some(v4);
        }
    }

    (public_ip, private_ip)
}

async fn fetch_public_ipv4() -> Option<Ipv4Addr> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(1200))
        .build()
        .ok()?;

    let urls = [
        "https://api.ipify.org",
        "https://ifconfig.me/ip",
        "https://ipv4.icanhazip.com",
    ];

    for url in urls {
        let Ok(resp) = client.get(url).send().await else {
            continue;
        };
        if !resp.status().is_success() {
            continue;
        }
        let Ok(text) = resp.text().await else {
            continue;
        };
        let Ok(ip) = text.trim().parse::<Ipv4Addr>() else {
            continue;
        };
        if is_public_ipv4(ip) {
            return Some(ip);
        }
    }

    None
}

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

        let (public_from_iface, private_from_iface) = scan_interface_ipv4();
        let public_ipv4 = if let Some(ip) = public_from_iface {
            Some(ip)
        } else {
            fetch_public_ipv4().await
        }
        .map(|v| v.to_string())
        .unwrap_or_default();
        let private_ipv4 = private_from_iface
            .map(|v| v.to_string())
            .unwrap_or_default();

        let reply = HealthCheckResponse {
            status: "SERVING".to_string(),
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            data_root: data_root_str,
            data_root_writable: writable,
            data_root_free_bytes: free_bytes(&data_root),
            ports,
            public_ipv4,
            private_ipv4,
        };
        Ok(Response::new(reply))
    }
}

pub fn server() -> AgentHealthServiceServer<HealthApi> {
    AgentHealthServiceServer::new(HealthApi)
}
