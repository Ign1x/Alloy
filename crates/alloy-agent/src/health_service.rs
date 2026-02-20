use alloy_proto::agent_v1::agent_health_service_server::{
    AgentHealthService, AgentHealthServiceServer,
};
use alloy_proto::agent_v1::{HealthCheckRequest, HealthCheckResponse, PortAvailability};
use std::net::{IpAddr, Ipv4Addr};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tonic::{Request, Response, Status};

#[derive(Debug, Default, Clone)]
pub struct HealthApi;

#[derive(Debug, Clone, Copy)]
struct HostSample {
    at: std::time::Instant,
    cpu_total_ticks: u64,
    cpu_idle_ticks: u64,
    net_rx_bytes: u64,
    net_tx_bytes: u64,
    disk_read_bytes: u64,
    disk_write_bytes: u64,
}

static LAST_HOST_SAMPLE: OnceLock<Mutex<Option<HostSample>>> = OnceLock::new();

fn host_metrics_sample() -> Option<HostSample> {
    #[cfg(not(target_os = "linux"))]
    {
        return None;
    }

    #[cfg(target_os = "linux")]
    {
        fn read_cpu_ticks() -> Option<(u64, u64)> {
            let s = std::fs::read_to_string("/proc/stat").ok()?;
            let first = s.lines().next()?;
            let mut it = first.split_whitespace();
            if it.next()? != "cpu" {
                return None;
            }
            let user: u64 = it.next()?.parse().ok()?;
            let nice: u64 = it.next()?.parse().ok()?;
            let system: u64 = it.next()?.parse().ok()?;
            let idle: u64 = it.next()?.parse().ok()?;
            let iowait: u64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let irq: u64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let softirq: u64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let steal: u64 = it.next().and_then(|v| v.parse().ok()).unwrap_or(0);
            let total = user
                .saturating_add(nice)
                .saturating_add(system)
                .saturating_add(idle)
                .saturating_add(iowait)
                .saturating_add(irq)
                .saturating_add(softirq)
                .saturating_add(steal);
            let idle_total = idle.saturating_add(iowait);
            Some((total, idle_total))
        }

        fn read_net_bytes() -> Option<(u64, u64)> {
            let s = std::fs::read_to_string("/proc/net/dev").ok()?;
            let mut rx_total: u64 = 0;
            let mut tx_total: u64 = 0;
            for line in s.lines().skip(2) {
                let Some((iface_raw, data_raw)) = line.split_once(':') else {
                    continue;
                };
                let iface = iface_raw.trim();
                if iface == "lo" {
                    continue;
                }
                let cols: Vec<&str> = data_raw.split_whitespace().collect();
                if cols.len() < 16 {
                    continue;
                }
                let rx = cols[0].parse::<u64>().ok().unwrap_or(0);
                let tx = cols[8].parse::<u64>().ok().unwrap_or(0);
                rx_total = rx_total.saturating_add(rx);
                tx_total = tx_total.saturating_add(tx);
            }
            Some((rx_total, tx_total))
        }

        fn include_disk(name: &str) -> bool {
            !(name.starts_with("loop")
                || name.starts_with("ram")
                || name.starts_with("zram")
                || name.starts_with("dm-")
                || name.starts_with("md"))
        }

        fn read_disk_bytes() -> Option<(u64, u64)> {
            let s = std::fs::read_to_string("/proc/diskstats").ok()?;
            let mut read_bytes: u64 = 0;
            let mut write_bytes: u64 = 0;
            for line in s.lines() {
                let cols: Vec<&str> = line.split_whitespace().collect();
                if cols.len() < 14 {
                    continue;
                }
                let name = cols[2];
                if !include_disk(name) {
                    continue;
                }
                let read_sectors = cols[5].parse::<u64>().ok().unwrap_or(0);
                let write_sectors = cols[9].parse::<u64>().ok().unwrap_or(0);
                read_bytes = read_bytes.saturating_add(read_sectors.saturating_mul(512));
                write_bytes = write_bytes.saturating_add(write_sectors.saturating_mul(512));
            }
            Some((read_bytes, write_bytes))
        }

        let (cpu_total_ticks, cpu_idle_ticks) = read_cpu_ticks()?;
        let (net_rx_bytes, net_tx_bytes) = read_net_bytes()?;
        let (disk_read_bytes, disk_write_bytes) = read_disk_bytes()?;
        Some(HostSample {
            at: std::time::Instant::now(),
            cpu_total_ticks,
            cpu_idle_ticks,
            net_rx_bytes,
            net_tx_bytes,
            disk_read_bytes,
            disk_write_bytes,
        })
    }
}

fn memory_usage_bytes() -> (u64, u64) {
    #[cfg(not(target_os = "linux"))]
    {
        (0, 0)
    }

    #[cfg(target_os = "linux")]
    {
        let s = match std::fs::read_to_string("/proc/meminfo") {
            Ok(v) => v,
            Err(_) => return (0, 0),
        };

        let mut total_kib: u64 = 0;
        let mut available_kib: u64 = 0;
        for line in s.lines() {
            if let Some(v) = line.strip_prefix("MemTotal:") {
                total_kib = v
                    .split_whitespace()
                    .next()
                    .and_then(|n| n.parse::<u64>().ok())
                    .unwrap_or(0);
            } else if let Some(v) = line.strip_prefix("MemAvailable:") {
                available_kib = v
                    .split_whitespace()
                    .next()
                    .and_then(|n| n.parse::<u64>().ok())
                    .unwrap_or(0);
            }
        }

        let total_bytes = total_kib.saturating_mul(1024);
        let avail_bytes = available_kib.saturating_mul(1024);
        let used_bytes = total_bytes.saturating_sub(avail_bytes);
        (used_bytes, total_bytes)
    }
}

fn host_rates() -> (u32, u64, u64, u64, u64) {
    let Some(now) = host_metrics_sample() else {
        return (0, 0, 0, 0, 0);
    };

    let slot = LAST_HOST_SAMPLE.get_or_init(|| Mutex::new(None));
    let mut guard = match slot.lock() {
        Ok(v) => v,
        Err(poisoned) => poisoned.into_inner(),
    };

    let prev = *guard;
    *guard = Some(now);

    let Some(prev) = prev else {
        return (0, 0, 0, 0, 0);
    };

    let elapsed = now.at.saturating_duration_since(prev.at).as_secs_f64();
    if elapsed <= 0.0 {
        return (0, 0, 0, 0, 0);
    }

    let total_delta = now.cpu_total_ticks.saturating_sub(prev.cpu_total_ticks);
    let idle_delta = now.cpu_idle_ticks.saturating_sub(prev.cpu_idle_ticks);
    let busy_delta = total_delta.saturating_sub(idle_delta);
    let cpu_percent_x100 = if total_delta == 0 {
        0
    } else {
        let v = busy_delta.saturating_mul(10_000) / total_delta;
        v.min(u64::from(u32::MAX)) as u32
    };

    let net_rx_per_sec = ((now.net_rx_bytes.saturating_sub(prev.net_rx_bytes)) as f64 / elapsed)
        .max(0.0)
        .round() as u64;
    let net_tx_per_sec = ((now.net_tx_bytes.saturating_sub(prev.net_tx_bytes)) as f64 / elapsed)
        .max(0.0)
        .round() as u64;
    let disk_read_per_sec = ((now.disk_read_bytes.saturating_sub(prev.disk_read_bytes)) as f64
        / elapsed)
        .max(0.0)
        .round() as u64;
    let disk_write_per_sec = ((now.disk_write_bytes.saturating_sub(prev.disk_write_bytes)) as f64
        / elapsed)
        .max(0.0)
        .round() as u64;

    (
        cpu_percent_x100,
        net_rx_per_sec,
        net_tx_per_sec,
        disk_read_per_sec,
        disk_write_per_sec,
    )
}

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

        let (
            cpu_percent_x100,
            network_rx_bytes_per_sec,
            network_tx_bytes_per_sec,
            disk_read_bytes_per_sec,
            disk_write_bytes_per_sec,
        ) = host_rates();
        let (memory_used_bytes, memory_total_bytes) = memory_usage_bytes();

        let reply = HealthCheckResponse {
            status: "SERVING".to_string(),
            agent_version: env!("CARGO_PKG_VERSION").to_string(),
            data_root: data_root_str,
            data_root_writable: writable,
            data_root_free_bytes: free_bytes(&data_root),
            ports,
            public_ipv4,
            private_ipv4,
            cpu_percent_x100,
            memory_used_bytes,
            memory_total_bytes,
            network_rx_bytes_per_sec,
            network_tx_bytes_per_sec,
            disk_read_bytes_per_sec,
            disk_write_bytes_per_sec,
        };
        Ok(Response::new(reply))
    }
}

pub fn server() -> AgentHealthServiceServer<HealthApi> {
    AgentHealthServiceServer::new(HealthApi)
}
