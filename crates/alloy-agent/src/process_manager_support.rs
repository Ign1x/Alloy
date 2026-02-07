use std::{
    collections::BTreeMap,
    sync::OnceLock,
    time::Duration,
};

const DEFAULT_LOG_MAX_LINES: usize = 1000;
const DEFAULT_LOG_FILE_MAX_BYTES: u64 = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_LOG_FILE_MAX_FILES: usize = 3;

pub(crate) fn env_usize(name: &str) -> Option<usize> {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
}

pub(crate) fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse::<u64>().ok())
}

pub(crate) fn log_max_lines() -> usize {
    env_usize("ALLOY_LOG_MAX_LINES")
        .map(|v| v.clamp(100, 50_000))
        .unwrap_or(DEFAULT_LOG_MAX_LINES)
}

pub(crate) fn log_file_limits() -> (u64, usize) {
    let max_bytes = env_u64("ALLOY_LOG_FILE_MAX_BYTES")
        .map(|v| v.clamp(256 * 1024, 1024 * 1024 * 1024))
        .unwrap_or(DEFAULT_LOG_FILE_MAX_BYTES);
    let max_files = env_usize("ALLOY_LOG_FILE_MAX_FILES")
        .map(|v| v.clamp(1, 20))
        .unwrap_or(DEFAULT_LOG_FILE_MAX_FILES);
    (max_bytes, max_files)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RestartPolicy {
    Off,
    Always,
    OnFailure,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct RestartConfig {
    pub(crate) policy: RestartPolicy,
    pub(crate) max_retries: u32,
    pub(crate) backoff_ms: u64,
    pub(crate) backoff_max_ms: u64,
}

pub(crate) fn format_error_chain(err: &anyhow::Error) -> String {
    let mut parts = Vec::<String>::new();
    for cause in err.chain() {
        let s = cause.to_string();
        if s.is_empty() {
            continue;
        }
        if parts.last() == Some(&s) {
            continue;
        }
        parts.push(s);
    }
    if parts.is_empty() {
        "unknown error".to_string()
    } else {
        parts.join(": ")
    }
}

pub(crate) fn parse_restart_config(params: &BTreeMap<String, String>) -> RestartConfig {
    let policy = match params
        .get("restart_policy")
        .map(|s| s.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("always") => RestartPolicy::Always,
        Some("on-failure") | Some("on_failure") | Some("onfailure") => RestartPolicy::OnFailure,
        _ => RestartPolicy::Off,
    };

    let max_retries = params
        .get("restart_max_retries")
        .and_then(|v| v.parse::<u32>().ok())
        .unwrap_or(10)
        .clamp(0, 1000);
    let backoff_ms = params
        .get("restart_backoff_ms")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(1000)
        .clamp(100, 10 * 60 * 1000);
    let backoff_max_ms = params
        .get("restart_backoff_max_ms")
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(30_000)
        .clamp(backoff_ms, 60 * 60 * 1000);

    RestartConfig {
        policy,
        max_retries,
        backoff_ms,
        backoff_max_ms,
    }
}

pub(crate) fn compute_backoff_ms(cfg: RestartConfig, attempt: u32) -> u64 {
    // attempt is 1-based.
    let pow = attempt.saturating_sub(1).min(30);
    let mult = 1u64.checked_shl(pow).unwrap_or(u64::MAX);
    cfg.backoff_ms.saturating_mul(mult).min(cfg.backoff_max_ms)
}

pub(crate) fn early_exit_threshold() -> Duration {
    Duration::from_millis(
        env_u64("ALLOY_EARLY_EXIT_MS")
            .map(|v| v.clamp(500, 60_000))
            .unwrap_or(5000),
    )
}

pub(crate) fn port_probe_timeout() -> Duration {
    Duration::from_millis(
        env_u64("ALLOY_PORT_PROBE_TIMEOUT_MS")
            .map(|v| v.clamp(1000, 10 * 60 * 1000))
            .unwrap_or(90_000),
    )
}

pub(crate) fn resource_sample_interval() -> Duration {
    Duration::from_millis(
        env_u64("ALLOY_RESOURCE_SAMPLE_INTERVAL_MS")
            .map(|v| v.clamp(250, 60_000))
            .unwrap_or(2000),
    )
}

#[cfg(target_os = "linux")]
pub(crate) fn ticks_per_sec() -> u64 {
    static TICKS: OnceLock<u64> = OnceLock::new();
    *TICKS.get_or_init(|| unsafe {
        let v = libc::sysconf(libc::_SC_CLK_TCK);
        if v <= 0 { 100 } else { v as u64 }
    })
}

#[cfg(not(target_os = "linux"))]
pub(crate) fn ticks_per_sec() -> u64 {
    100
}

#[cfg(target_os = "linux")]
fn page_size() -> u64 {
    static PAGE: OnceLock<u64> = OnceLock::new();
    *PAGE.get_or_init(|| unsafe {
        let v = libc::sysconf(libc::_SC_PAGESIZE);
        if v <= 0 { 4096 } else { v as u64 }
    })
}

#[cfg(not(target_os = "linux"))]
fn page_size() -> u64 {
    4096
}

#[cfg(target_os = "linux")]
pub(crate) async fn read_proc_cpu_ticks(pid: u32) -> Option<u64> {
    let stat_path = format!("/proc/{pid}/stat");
    let s = tokio::fs::read_to_string(stat_path).await.ok()?;
    let end = s.rfind(')')?;
    let rest = s.get((end + 2)..)?;
    let parts: Vec<&str> = rest.split_whitespace().collect();
    let utime: u64 = parts.get(11)?.parse().ok()?;
    let stime: u64 = parts.get(12)?.parse().ok()?;
    Some(utime.saturating_add(stime))
}

#[cfg(not(target_os = "linux"))]
pub(crate) async fn read_proc_cpu_ticks(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
pub(crate) async fn read_proc_rss_bytes(pid: u32) -> Option<u64> {
    let statm_path = format!("/proc/{pid}/statm");
    let s = tokio::fs::read_to_string(statm_path).await.ok()?;
    let mut it = s.split_whitespace();
    let _size_pages = it.next()?;
    let resident_pages: u64 = it.next()?.parse().ok()?;
    Some(resident_pages.saturating_mul(page_size()))
}

#[cfg(not(target_os = "linux"))]
pub(crate) async fn read_proc_rss_bytes(_pid: u32) -> Option<u64> {
    None
}
