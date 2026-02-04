use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use alloy_process::{ProcessId, ProcessState, ProcessStatus, ProcessTemplateId};
use anyhow::Context;
use serde::Serialize;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::Mutex,
    sync::mpsc,
};

use crate::minecraft;
use crate::minecraft_download;
use crate::port_alloc;
use crate::templates;
use crate::terraria;
use crate::terraria_download;

const DEFAULT_LOG_MAX_LINES: usize = 1000;
const DEFAULT_LOG_FILE_MAX_BYTES: u64 = 10 * 1024 * 1024; // 10 MiB
const DEFAULT_LOG_FILE_MAX_FILES: usize = 3;

fn env_usize(name: &str) -> Option<usize> {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse::<usize>().ok())
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse::<u64>().ok())
}

fn log_max_lines() -> usize {
    env_usize("ALLOY_LOG_MAX_LINES")
        .map(|v| v.clamp(100, 50_000))
        .unwrap_or(DEFAULT_LOG_MAX_LINES)
}

fn log_file_limits() -> (u64, usize) {
    let max_bytes = env_u64("ALLOY_LOG_FILE_MAX_BYTES")
        .map(|v| v.clamp(256 * 1024, 1024 * 1024 * 1024))
        .unwrap_or(DEFAULT_LOG_FILE_MAX_BYTES);
    let max_files = env_usize("ALLOY_LOG_FILE_MAX_FILES")
        .map(|v| v.clamp(1, 20))
        .unwrap_or(DEFAULT_LOG_FILE_MAX_FILES);
    (max_bytes, max_files)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RestartPolicy {
    Off,
    Always,
    OnFailure,
}

#[derive(Clone, Copy, Debug)]
struct RestartConfig {
    policy: RestartPolicy,
    max_retries: u32,
    backoff_ms: u64,
    backoff_max_ms: u64,
}

fn parse_restart_config(params: &BTreeMap<String, String>) -> RestartConfig {
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

fn compute_backoff_ms(cfg: RestartConfig, attempt: u32) -> u64 {
    // attempt is 1-based.
    let pow = attempt.saturating_sub(1).min(30);
    let mult = 1u64.checked_shl(pow).unwrap_or(u64::MAX);
    cfg.backoff_ms.saturating_mul(mult).min(cfg.backoff_max_ms)
}

fn early_exit_threshold() -> Duration {
    Duration::from_millis(
        env_u64("ALLOY_EARLY_EXIT_MS")
            .map(|v| v.clamp(500, 60_000))
            .unwrap_or(5000),
    )
}

fn port_probe_timeout() -> Duration {
    Duration::from_millis(
        env_u64("ALLOY_PORT_PROBE_TIMEOUT_MS")
            .map(|v| v.clamp(1000, 10 * 60 * 1000))
            .unwrap_or(90_000),
    )
}

fn resource_sample_interval() -> Duration {
    Duration::from_millis(
        env_u64("ALLOY_RESOURCE_SAMPLE_INTERVAL_MS")
            .map(|v| v.clamp(250, 60_000))
            .unwrap_or(2000),
    )
}

#[cfg(target_os = "linux")]
fn ticks_per_sec() -> u64 {
    static TICKS: OnceLock<u64> = OnceLock::new();
    *TICKS.get_or_init(|| unsafe {
        let v = libc::sysconf(libc::_SC_CLK_TCK);
        if v <= 0 { 100 } else { v as u64 }
    })
}

#[cfg(not(target_os = "linux"))]
fn ticks_per_sec() -> u64 {
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
async fn read_proc_cpu_ticks(pid: u32) -> Option<u64> {
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
async fn read_proc_cpu_ticks(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
async fn read_proc_rss_bytes(pid: u32) -> Option<u64> {
    let statm_path = format!("/proc/{pid}/statm");
    let s = tokio::fs::read_to_string(statm_path).await.ok()?;
    let mut it = s.split_whitespace();
    let _size_pages = it.next()?;
    let resident_pages: u64 = it.next()?.parse().ok()?;
    Some(resident_pages.saturating_mul(page_size()))
}

#[cfg(not(target_os = "linux"))]
async fn read_proc_rss_bytes(_pid: u32) -> Option<u64> {
    None
}

#[cfg(target_os = "linux")]
async fn read_proc_io_bytes(pid: u32) -> Option<(u64, u64)> {
    let io_path = format!("/proc/{pid}/io");
    let s = tokio::fs::read_to_string(io_path).await.ok()?;
    let mut read_bytes: u64 = 0;
    let mut write_bytes: u64 = 0;
    for line in s.lines() {
        let line = line.trim();
        if let Some(v) = line.strip_prefix("read_bytes:") {
            read_bytes = v.trim().parse().unwrap_or(0);
        } else if let Some(v) = line.strip_prefix("write_bytes:") {
            write_bytes = v.trim().parse().unwrap_or(0);
        }
    }
    Some((read_bytes, write_bytes))
}

#[cfg(not(target_os = "linux"))]
async fn read_proc_io_bytes(_pid: u32) -> Option<(u64, u64)> {
    None
}

fn cpu_percent_x100(
    prev_ticks: u64,
    prev_at: tokio::time::Instant,
    ticks: u64,
    now: tokio::time::Instant,
) -> u32 {
    let dt = now.duration_since(prev_at).as_secs_f64();
    if dt <= 0.0 {
        return 0;
    }
    let delta_ticks = ticks.saturating_sub(prev_ticks) as f64;
    let cpu = (delta_ticks / ticks_per_sec() as f64) / dt * 100.0;
    // 1/100 of a percent.
    let x100 = (cpu * 100.0).round();
    if x100.is_finite() {
        x100.clamp(0.0, u32::MAX as f64) as u32
    } else {
        0
    }
}

const DEFAULT_MIN_FREE_SPACE_BYTES: u64 = 1024 * 1024 * 1024; // 1 GiB

fn min_free_space_bytes() -> u64 {
    env_u64("ALLOY_MIN_FREE_SPACE_BYTES")
        .map(|v| v.clamp(0, 1024_u64 * 1024 * 1024 * 1024))
        .unwrap_or(DEFAULT_MIN_FREE_SPACE_BYTES)
}

#[cfg(unix)]
fn free_bytes(p: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;

    let c = CString::new(p.as_os_str().as_bytes()).ok()?;
    let mut s: libc::statvfs = unsafe { std::mem::zeroed() };
    let rc = unsafe { libc::statvfs(c.as_ptr(), &mut s) };
    if rc != 0 {
        return None;
    }
    Some(s.f_bsize.saturating_mul(s.f_bavail))
}

#[cfg(not(unix))]
fn free_bytes(_p: &Path) -> Option<u64> {
    None
}

fn ensure_min_free_space(path: &Path) -> anyhow::Result<()> {
    let min = min_free_space_bytes();
    if min == 0 {
        return Ok(());
    }

    let Some(free) = free_bytes(path) else {
        return Ok(());
    };
    if free < min {
        anyhow::bail!(
            "insufficient disk space: free {} bytes < required {} bytes at {} (set ALLOY_MIN_FREE_SPACE_BYTES=0 to disable)",
            free,
            min,
            path.display()
        );
    }
    Ok(())
}

fn check_ldd_missing(path: &Path) -> anyhow::Result<Vec<String>> {
    let out = match std::process::Command::new("ldd").arg(path).output() {
        Ok(v) => v,
        Err(_) => return Ok(Vec::new()),
    };

    // ldd output format varies; treat any "not found" line as missing dep.
    let text = String::from_utf8_lossy(&out.stdout);
    let mut missing = Vec::new();
    for line in text.lines() {
        if line.contains("not found") {
            missing.push(line.trim().to_string());
        }
    }
    Ok(missing)
}

fn graceful_term_grace() -> Duration {
    Duration::from_secs(
        env_u64("ALLOY_GRACEFUL_TERM_GRACE_SEC")
            .map(|v| v.clamp(1, 60))
            .unwrap_or(5),
    )
}

fn parse_java_major_from_version_line(first_line: &str) -> anyhow::Result<u32> {
    // Typical formats:
    // - openjdk version "21.0.2" 2024-01-16
    // - java version "1.8.0_402"
    // Some builds omit quotes:
    // - openjdk 21.0.2 2024-01-16

    let ver = if let Some(quoted) = first_line.split('"').nth(1) {
        quoted
    } else {
        // Fall back to the first whitespace token that starts with a digit.
        // This intentionally avoids parsing dates like 2024-01-16 because
        // the version token appears earlier.
        first_line
            .split_whitespace()
            .find(|t| t.chars().next().is_some_and(|c| c.is_ascii_digit()))
            .ok_or_else(|| anyhow::anyhow!("failed to parse java version output: {first_line}"))?
    };

    let parse_leading_u32 = |s: &str| -> anyhow::Result<u32> {
        let end = s.find(|c: char| !c.is_ascii_digit()).unwrap_or(s.len());
        if end == 0 {
            anyhow::bail!("failed to parse java major from: {ver}");
        }
        s[..end]
            .parse::<u32>()
            .map_err(|_| anyhow::anyhow!("failed to parse java major from: {ver}"))
    };

    let major = if ver.starts_with("1.") {
        // Legacy "1.8.x" form.
        let second = ver.split('.').nth(1).unwrap_or("");
        parse_leading_u32(second)?
    } else {
        let first = ver.split('.').next().unwrap_or("");
        parse_leading_u32(first)?
    };

    Ok(major)
}

fn detect_java_major() -> anyhow::Result<u32> {
    // Use the runtime `java` in PATH. We vendor Java 21 in the Docker image,
    // but this also supports local dev installs.
    let out = std::process::Command::new("java")
        .arg("-version")
        .output()
        .context("run `java -version`")?;
    let text = String::from_utf8_lossy(&out.stderr);
    let first = text.lines().next().unwrap_or_default();

    parse_java_major_from_version_line(first)
}

#[cfg(test)]
mod tests {
    use super::parse_java_major_from_version_line;

    #[test]
    fn parse_java_major_modern_openjdk() {
        let line = "openjdk version \"21.0.2\" 2024-01-16";
        assert_eq!(parse_java_major_from_version_line(line).unwrap(), 21);
    }

    #[test]
    fn parse_java_major_modern_no_quotes() {
        let line = "openjdk 21.0.2 2024-01-16";
        assert_eq!(parse_java_major_from_version_line(line).unwrap(), 21);
    }

    #[test]
    fn parse_java_major_legacy_1_8() {
        let line = "java version \"1.8.0_402\"";
        assert_eq!(parse_java_major_from_version_line(line).unwrap(), 8);
    }

    #[test]
    fn parse_java_major_bare_major() {
        let line = "openjdk version 17.0.9 2023-10-17";
        assert_eq!(parse_java_major_from_version_line(line).unwrap(), 17);
    }

    #[test]
    fn parse_java_major_rejects_garbage() {
        let err = parse_java_major_from_version_line("not java").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("failed to parse java version output"));
    }

    #[test]
    fn parse_java_major_rejects_non_numeric() {
        let err = parse_java_major_from_version_line("openjdk version \"abc\"").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("failed to parse java major"));
    }
}

#[derive(Debug)]
struct LogBuffer {
    next_seq: u64,
    max_lines: usize,
    lines: VecDeque<(u64, String)>,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self {
            next_seq: 1,
            max_lines: log_max_lines(),
            lines: VecDeque::new(),
        }
    }
}

impl LogBuffer {
    fn push_line(&mut self, line: String) {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        self.lines.push_back((seq, line));
        while self.lines.len() > self.max_lines {
            self.lines.pop_front();
        }
    }

    fn tail_after(&self, cursor: u64, limit: usize) -> (Vec<String>, u64) {
        // Convenience for UI polling: if cursor is 0, return the most recent lines.
        if cursor == 0 {
            let start = self.lines.len().saturating_sub(limit);
            let mut out = Vec::new();
            let mut last = 0;
            for (seq, line) in self.lines.iter().skip(start) {
                out.push(line.clone());
                last = *seq;
            }
            return (out, last);
        }

        let mut out = Vec::new();
        let mut last = cursor;
        for (seq, line) in self.lines.iter() {
            if *seq > cursor {
                out.push(line.clone());
                last = *seq;
                if out.len() >= limit {
                    break;
                }
            }
        }
        (out, last)
    }
}

#[derive(Clone)]
struct LogSink {
    buffer: Arc<Mutex<LogBuffer>>,
    file_tx: Option<mpsc::UnboundedSender<String>>,
}

impl LogSink {
    async fn emit(&self, line: impl Into<String>) {
        let line = line.into();
        self.buffer.lock().await.push_line(line.clone());
        if let Some(tx) = &self.file_tx {
            let _ = tx.send(line);
        }
    }
}

struct FileLogWriter {
    path: PathBuf,
    max_bytes: u64,
    max_files: usize,
    bytes: u64,
    file: tokio::fs::File,
}

impl FileLogWriter {
    async fn open(path: PathBuf, max_bytes: u64, max_files: usize) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        let bytes = tokio::fs::metadata(&path)
            .await
            .map(|m| m.len())
            .unwrap_or(0);
        let file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .await?;

        Ok(Self {
            path,
            max_bytes,
            max_files,
            bytes,
            file,
        })
    }

    async fn rotate(&mut self) -> std::io::Result<()> {
        let _ = self.file.flush().await;

        // Shift old rotations: .(n-1) -> .n
        for i in (1..self.max_files).rev() {
            let from = PathBuf::from(format!("{}.{}", self.path.display(), i));
            let to = PathBuf::from(format!("{}.{}", self.path.display(), i + 1));
            if tokio::fs::metadata(&from).await.is_ok() {
                let _ = tokio::fs::rename(from, to).await;
            }
        }

        // Current -> .1
        let rotated = PathBuf::from(format!("{}.1", self.path.display()));
        if tokio::fs::metadata(&self.path).await.is_ok() {
            let _ = tokio::fs::rename(&self.path, &rotated).await;
        }

        self.file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        self.bytes = 0;
        Ok(())
    }

    async fn write_line(&mut self, line: &str) -> std::io::Result<()> {
        let mut line = line.to_string();
        if !line.ends_with('\n') {
            line.push('\n');
        }

        let write_len = line.len() as u64;
        if self.max_bytes > 0 && self.bytes.saturating_add(write_len) > self.max_bytes {
            self.rotate().await.ok();
        }

        self.file.write_all(line.as_bytes()).await?;
        self.bytes = self.bytes.saturating_add(write_len);
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
struct RunInfo {
    process_id: String,
    template_id: String,
    started_at_unix_ms: u64,
    agent_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pgid: Option<i32>,
    exec: String,
    args: Vec<String>,
    cwd: String,
    // Params are redacted for known secret keys.
    params: BTreeMap<String, String>,
    env: BTreeMap<String, String>,
}

fn redact_params(mut params: BTreeMap<String, String>) -> BTreeMap<String, String> {
    for k in ["password"] {
        if params.contains_key(k) {
            params.insert(k.to_string(), "<redacted>".to_string());
        }
    }
    params
}

async fn write_run_json(dir: &Path, info: &RunInfo) -> anyhow::Result<()> {
    tokio::fs::create_dir_all(dir)
        .await
        .context("create instance dir")?;
    let path = dir.join("run.json");
    let tmp = dir.join("run.json.tmp");
    let data = serde_json::to_vec_pretty(info).context("serialize run.json")?;
    let mut f = tokio::fs::File::create(&tmp)
        .await
        .context("create run.json.tmp")?;
    f.write_all(&data).await.context("write run.json.tmp")?;
    f.flush().await.ok();
    tokio::fs::rename(&tmp, &path)
        .await
        .context("persist run.json")?;
    Ok(())
}

fn collect_safe_env() -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for key in ["ALLOY_DATA_ROOT", "JAVA_HOME", "LD_LIBRARY_PATH", "PATH"] {
        if let Ok(v) = std::env::var(key) {
            let val = if key == "PATH" && v.len() > 512 {
                format!("{}…(truncated)", &v[..512])
            } else {
                v
            };
            out.insert(key.to_string(), val);
        }
    }
    out
}

#[cfg(target_os = "linux")]
unsafe fn set_parent_death_signal() -> std::io::Result<()> {
    // If the agent process dies (crash/kill), ensure the child is terminated.
    // NOTE: `unsafe fn` bodies are not implicitly unsafe in Rust 2024.
    let rc = unsafe { libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) };
    if rc == -1 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(not(target_os = "linux"))]
unsafe fn set_parent_death_signal() -> std::io::Result<()> {
    Ok(())
}

async fn wait_for_local_tcp_port(port: u16, timeout: Duration) -> bool {
    let deadline = tokio::time::Instant::now() + timeout;
    loop {
        if let Ok(s) = tokio::net::TcpStream::connect(("127.0.0.1", port)).await {
            drop(s);
            return true;
        }

        if tokio::time::Instant::now() >= deadline {
            return false;
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
}

async fn set_entry_message(
    inner: &Arc<Mutex<HashMap<String, ProcessEntry>>>,
    process_id: &str,
    message: Option<String>,
) {
    let mut map = inner.lock().await;
    let Some(e) = map.get_mut(process_id) else {
        return;
    };
    e.message = message;
}

#[derive(Debug)]
struct ProcessEntry {
    template_id: ProcessTemplateId,
    state: ProcessState,
    pid: Option<u32>,
    resources: Option<alloy_process::ProcessResources>,
    exit_code: Option<i32>,
    message: Option<String>,
    restart: RestartConfig,
    restart_attempts: u32,
    stdin: Option<ChildStdin>,
    graceful_stdin: Option<String>,
    pgid: Option<i32>,
    logs: Arc<Mutex<LogBuffer>>,
    log_file_tx: Option<mpsc::UnboundedSender<String>>,
}

#[derive(Clone, Debug, Default)]
pub struct ProcessManager {
    inner: Arc<Mutex<HashMap<String, ProcessEntry>>>,
}

impl ProcessManager {
    fn spawn_resource_sampler(&self, process_id: String, pid: u32) {
        let inner = self.inner.clone();
        tokio::spawn(async move {
            let mut last: Option<(u64, tokio::time::Instant)> = None;
            let interval = resource_sample_interval();

            loop {
                let now = tokio::time::Instant::now();
                let Some(ticks) = read_proc_cpu_ticks(pid).await else {
                    break;
                };
                let rss_bytes = read_proc_rss_bytes(pid).await.unwrap_or(0);
                let (read_bytes, write_bytes) = read_proc_io_bytes(pid).await.unwrap_or((0, 0));

                let cpu_percent_x100 = last
                    .map(|(prev_ticks, prev_at)| cpu_percent_x100(prev_ticks, prev_at, ticks, now))
                    .unwrap_or(0);
                last = Some((ticks, now));

                {
                    let mut map = inner.lock().await;
                    let Some(e) = map.get_mut(&process_id) else {
                        break;
                    };
                    if e.pid != Some(pid) {
                        break;
                    }
                    e.resources = Some(alloy_process::ProcessResources {
                        cpu_percent_x100,
                        rss_bytes,
                        read_bytes,
                        write_bytes,
                    });
                }

                tokio::time::sleep(interval).await;
            }
        });
    }

    pub async fn start_from_template_with_process_id(
        &self,
        process_id: &str,
        template_id: &str,
        mut params: BTreeMap<String, String>,
    ) -> anyhow::Result<ProcessStatus> {
        if process_id.is_empty() {
            anyhow::bail!("process_id must be non-empty");
        }

        let mut reused_logs: Option<Arc<Mutex<LogBuffer>>> = None;
        let mut reused_restart_attempts: u32 = 0;

        // Keep the ID stable (instance_id == process_id for MVP).
        // Allow restarting after exit/failure by replacing the old entry.
        {
            let mut inner = self.inner.lock().await;
            if let Some(existing) = inner.get(process_id)
                && matches!(
                    existing.state,
                    ProcessState::Running | ProcessState::Starting | ProcessState::Stopping
                )
            {
                anyhow::bail!("process_id already running: {process_id}");
            }
            // Remove any stale entry so we can re-use the same id.
            if let Some(old) = inner.remove(process_id) {
                reused_restart_attempts = old.restart_attempts;
                reused_logs = Some(old.logs);
            }
        }

        let base = templates::find_template(template_id)
            .ok_or_else(|| anyhow::anyhow!("unknown template_id: {template_id}"))?;
        let t = templates::apply_params(base, &params)?;

        let id = ProcessId(process_id.to_string());
        let logs: Arc<Mutex<LogBuffer>> =
            reused_logs.unwrap_or_else(|| Arc::new(Mutex::new(LogBuffer::default())));

        let root_dir =
            if t.template_id == "minecraft:vanilla" || t.template_id == "terraria:vanilla" {
                minecraft::instance_dir(&id.0)
            } else {
                minecraft::data_root().join("processes").join(&id.0)
            };

        let console_log_path = root_dir.join("logs").join("console.log");
        let (max_bytes, max_files) = log_file_limits();
        let (log_tx, mut log_rx) = mpsc::unbounded_channel::<String>();
        tokio::spawn({
            let path = console_log_path.clone();
            async move {
                let Ok(mut writer) = FileLogWriter::open(path, max_bytes, max_files).await else {
                    return;
                };
                while let Some(line) = log_rx.recv().await {
                    let _ = writer.write_line(&line).await;
                }
            }
        });

        let sink = LogSink {
            buffer: logs.clone(),
            file_tx: Some(log_tx.clone()),
        };

        sink.emit(format!(
            "[alloy-agent] start requested: template_id={} process_id={}",
            t.template_id, id.0
        ))
        .await;

        // Insert an entry early so the UI can show progress (download/extract/spawn) during long starts.
        let initial_restart = parse_restart_config(&params);
        {
            let mut inner = self.inner.lock().await;
            inner.insert(
                id.0.clone(),
                ProcessEntry {
                    template_id: ProcessTemplateId(t.template_id.clone()),
                    state: ProcessState::Starting,
                    pid: None,
                    resources: None,
                    exit_code: None,
                    message: Some("starting...".to_string()),
                    restart: initial_restart,
                    restart_attempts: reused_restart_attempts,
                    stdin: None,
                    graceful_stdin: t.graceful_stdin.clone(),
                    pgid: None,
                    logs: logs.clone(),
                    log_file_tx: Some(log_tx.clone()),
                },
            );
        }

        let result: anyhow::Result<ProcessStatus> = async {
            if t.template_id == "minecraft:vanilla" {
                ensure_min_free_space(&minecraft::data_root()).map_err(|e| {
                    crate::error_payload::anyhow(
                        "insufficient_disk",
                        e.to_string(),
                        None,
                        Some("Free up disk space under ALLOY_DATA_ROOT and try again.".to_string()),
                    )
                })?;

                let mc = minecraft::validate_vanilla_params(&params)?;

                // Allow auto port assignment (port=0 means "auto").
                let mc_port = port_alloc::allocate_tcp_port(mc.port).map_err(|e| {
                    let mut fields = BTreeMap::new();
                    fields.insert("port".to_string(), e.to_string());
                    crate::error_payload::anyhow(
                        "invalid_param",
                        "invalid port",
                        Some(fields),
                        Some(
                            "Pick another port, or leave it blank (0) to auto-assign a free port."
                                .to_string(),
                        ),
                    )
                })?;
                let mc = minecraft::VanillaParams {
                    port: mc_port,
                    ..mc
                };
                params.insert("port".to_string(), mc_port.to_string());
                let restart = parse_restart_config(&params);

                let dir = minecraft::instance_dir(&id.0);
                minecraft::ensure_vanilla_instance_layout(&dir, &mc)?;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("resolving minecraft version metadata...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] resolving minecraft version metadata".to_string())
                    .await;
                let resolved = minecraft_download::resolve_server_jar(&mc.version)
                    .await
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "download_failed",
                            format!("failed to resolve minecraft server jar: {e}"),
                            None,
                            Some(
                                "Check network connectivity to Mojang piston-meta endpoints."
                                    .to_string(),
                            ),
                        )
                    })?;
                let have_java = detect_java_major()?;
                if have_java != resolved.java_major {
                    return Err(crate::error_payload::anyhow(
                        "java_major_mismatch",
                        format!(
                            "Need Java {} for Minecraft {}, but runtime has Java {}.",
                            resolved.java_major, resolved.version_id, have_java
                        ),
                        None,
                        Some(format!(
                            "Install Java {} (Temurin recommended), or use the Alloy agent Docker image.",
                            resolved.java_major
                        )),
                    ));
                }

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("downloading minecraft server.jar...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] downloading minecraft server.jar".to_string())
                    .await;
                let cached_jar = minecraft_download::ensure_server_jar(&resolved)
                    .await
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "download_failed",
                            format!("failed to download minecraft server jar: {e}"),
                            None,
                            Some("Try again; if it persists, clear cache and retry.".to_string()),
                        )
                    })?;

                let instance_jar = dir.join("server.jar");
                if !instance_jar.exists() {
                    #[cfg(unix)]
                    {
                        std::os::unix::fs::symlink(&cached_jar, &instance_jar)?;
                    }
                    #[cfg(not(unix))]
                    {
                        std::fs::copy(&cached_jar, &instance_jar)?;
                    }
                }

                let mut cmd = Command::new("java");
                let exec = "java".to_string();
                let args = vec![
                    format!("-Xmx{}M", mc.memory_mb),
                    "-jar".to_string(),
                    "server.jar".to_string(),
                    "nogui".to_string(),
                ];

                cmd.current_dir(&dir)
                    .args(&args)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                let started_at_unix_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let mut run = RunInfo {
                    process_id: id.0.clone(),
                    template_id: t.template_id.clone(),
                    started_at_unix_ms,
                    agent_version: env!("CARGO_PKG_VERSION").to_string(),
                    pid: None,
                    pgid: None,
                    exec: exec.clone(),
                    args: args.clone(),
                    cwd: dir.display().to_string(),
                    params: redact_params(params.clone()),
                    env: collect_safe_env(),
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!(
                    "[alloy-agent] minecraft exec: {} {} (cwd {}) port={} version={}",
                    exec,
                    args.join(" "),
                    dir.display(),
                    mc.port,
                    resolved.version_id
                ))
                .await;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some(format!("spawning minecraft server (port {})...", mc.port)),
                )
                .await;

                #[cfg(unix)]
                {
                    unsafe {
                        cmd.pre_exec(|| {
                            set_parent_death_signal()?;
                            if libc::setsid() == -1 {
                                return Err(std::io::Error::last_os_error());
                            }
                            Ok(())
                        });
                    }
                }

                let mut child = cmd
                    .spawn()
                    .with_context(|| format!("spawn minecraft server (cwd {})", dir.display()))
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "spawn_failed",
                            e.to_string(),
                            None,
                            Some(
                                "Ensure Java is installed and the instance directory is writable."
                                    .to_string(),
                            ),
                        )
                    })?;
                let started = tokio::time::Instant::now();
                let pid_u32 = child.id();
                let pgid = pid_u32.map(|p| p as i32);

                run.pid = pid_u32;
                run.pgid = pgid;
                let _ = write_run_json(&dir, &run).await;

                let stdin = child.stdin.take();
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                if let Some(out) = stdout {
                    let sink = sink.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(out).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            sink.emit(format!("[stdout] {line}")).await;
                        }
                    });
                }
                if let Some(err) = stderr {
                    let sink = sink.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(err).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            sink.emit(format!("[stderr] {line}")).await;
                        }
                    });
                }

                {
                    let mut inner = self.inner.lock().await;
                    inner.insert(
                        id.0.clone(),
                        ProcessEntry {
                            template_id: ProcessTemplateId(t.template_id.clone()),
                            state: ProcessState::Starting,
                            pid: pid_u32,
                            resources: None,
                            exit_code: None,
                            message: Some(format!("waiting for port {}...", mc.port)),
                            restart,
                            restart_attempts: reused_restart_attempts,
                            stdin,
                            graceful_stdin: t.graceful_stdin.clone(),
                            pgid,
                            logs: logs.clone(),
                            log_file_tx: Some(log_tx.clone()),
                        },
                    );
                }

                if let Some(pid) = pid_u32 {
                    self.spawn_resource_sampler(id.0.clone(), pid);
                }

                let manager = self.clone();
                let inner = self.inner.clone();
                let id_str = id.0.clone();

                // Port probe: only mark Running once the server actually listens.
                let probe_sink = sink.clone();
                let port = mc.port;
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    async move {
                        let timeout = port_probe_timeout();
                        let ok = wait_for_local_tcp_port(port, timeout).await;

                        let (pgid, should_kill) = {
                            let mut map = inner.lock().await;
                            let Some(e) = map.get_mut(&id_str) else {
                                return;
                            };
                            if e.pid != pid_u32 || !matches!(e.state, ProcessState::Starting) {
                                return;
                            }

                            if ok {
                                e.state = ProcessState::Running;
                                e.message = None;
                                (e.pgid, false)
                            } else {
                                e.state = ProcessState::Failed;
                                e.message = Some(format!(
                                    "port {} did not open within {}ms",
                                    port,
                                    timeout.as_millis()
                                ));
                                (e.pgid, true)
                            }
                        };

                        if ok {
                            probe_sink
                                .emit(format!(
                                    "[alloy-agent] minecraft port {} is accepting connections",
                                    port
                                ))
                                .await;
                        } else {
                            probe_sink
                                .emit(format!(
                                    "[alloy-agent] minecraft port {} did not open in time",
                                    port
                                ))
                                .await;
                            if should_kill && let Some(pgid) = pgid {
                                #[cfg(unix)]
                                unsafe {
                                    libc::kill(-pgid, libc::SIGTERM);
                                }
                            }
                        }
                    }
                });

                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    let runtime = tokio::time::Instant::now().duration_since(started);

                    let mut restart_after: Option<Duration> = None;
                    let mut restart_attempt: u32 = 0;

                    let (final_state, exit_code) = {
                        let mut map = inner.lock().await;
                        let Some(e) = map.get_mut(&id_str) else {
                            return;
                        };

                        e.stdin = None;
                        let stopping = matches!(e.state, ProcessState::Stopping);

                        match res {
                            Ok(status) => {
                                e.exit_code = status.code();

                                if stopping {
                                    e.state = ProcessState::Exited;
                                    e.message = Some("stopped".to_string());
                                } else if runtime < early_exit_threshold() {
                                    e.state = ProcessState::Failed;
                                    e.message = Some(format!(
                                        "exited too quickly ({}ms)",
                                        runtime.as_millis()
                                    ));
                                } else if status.success() {
                                    e.state = ProcessState::Exited;
                                    e.message = Some("exited".to_string());
                                } else {
                                    e.state = ProcessState::Failed;
                                    e.message = Some(format!(
                                        "exited with code {}",
                                        status.code().unwrap_or_default()
                                    ));
                                }
                            }
                            Err(err) => {
                                e.state = ProcessState::Failed;
                                e.message = Some(format!("wait failed: {err}"));
                            }
                        }

                        if !stopping {
                            let is_failure = matches!(e.state, ProcessState::Failed)
                                || e.exit_code.is_some_and(|c| c != 0);
                            let should_restart = match e.restart.policy {
                                RestartPolicy::Off => false,
                                RestartPolicy::Always => true,
                                RestartPolicy::OnFailure => is_failure,
                            };

                            if should_restart && e.restart_attempts < e.restart.max_retries {
                                e.restart_attempts = e.restart_attempts.saturating_add(1);
                                let delay_ms = compute_backoff_ms(e.restart, e.restart_attempts);
                                restart_after = Some(Duration::from_millis(delay_ms));
                                restart_attempt = e.restart_attempts;
                                e.message = Some(format!(
                                    "restarting in {}ms (attempt {}/{})",
                                    delay_ms, restart_attempt, e.restart.max_retries
                                ));
                            }
                        }

                        (e.state, e.exit_code)
                    };

                    wait_sink
                        .emit(format!(
                            "[alloy-agent] process exited: state={:?} exit_code={:?} runtime_ms={}",
                            final_state,
                            exit_code,
                            runtime.as_millis()
                        ))
                        .await;

                    if let Some(delay) = restart_after {
                        wait_sink
                            .emit(format!(
                                "[alloy-agent] auto-restart scheduled in {}ms (attempt {})",
                                delay.as_millis(),
                                restart_attempt
                            ))
                            .await;
                        let handle = tokio::runtime::Handle::current();
                        let wait_sink = wait_sink.clone();
                        tokio::task::spawn_blocking(move || {
                            std::thread::sleep(delay);
                            let res = handle.block_on(manager.start_from_template_with_process_id(
                                &id_str,
                                &template_id,
                                params_for_restart,
                            ));
                            match res {
                                Ok(st) if matches!(st.state, ProcessState::Failed) => {
                                    let msg = st
                                        .message
                                        .filter(|s| !s.trim().is_empty())
                                        .unwrap_or_else(|| "unknown error".to_string());
                                    handle.block_on(wait_sink.emit(format!(
                                        "[alloy-agent] auto-restart failed: {msg}"
                                    )));
                                }
                                Ok(_) => {
                                    handle.block_on(wait_sink.emit(
                                        "[alloy-agent] auto-restart triggered".to_string(),
                                    ));
                                }
                                Err(err) => {
                                    handle.block_on(wait_sink.emit(format!(
                                        "[alloy-agent] auto-restart failed: {err}"
                                    )));
                                }
                            }
                        });
                    }
                });

                return Ok(ProcessStatus {
                    id: id.clone(),
                    template_id: ProcessTemplateId(t.template_id.clone()),
                    state: ProcessState::Starting,
                    pid: pid_u32,
                    exit_code: None,
                    message: Some(format!("waiting for port {}...", mc.port)),
                    resources: None,
                });
            }

            if t.template_id == "terraria:vanilla" {
                ensure_min_free_space(&terraria::data_root()).map_err(|e| {
                    crate::error_payload::anyhow(
                        "insufficient_disk",
                        e.to_string(),
                        None,
                        Some("Free up disk space under ALLOY_DATA_ROOT and try again.".to_string()),
                    )
                })?;

                let tr = terraria::validate_vanilla_params(&params)?;

                let tr_port = port_alloc::allocate_tcp_port(tr.port).map_err(|e| {
                    let mut fields = BTreeMap::new();
                    fields.insert("port".to_string(), e.to_string());
                    crate::error_payload::anyhow(
                        "invalid_param",
                        "invalid port",
                        Some(fields),
                        Some(
                            "Pick another port, or leave it blank (0) to auto-assign a free port."
                                .to_string(),
                        ),
                    )
                })?;
                let tr = terraria::VanillaParams {
                    port: tr_port,
                    ..tr
                };
                params.insert("port".to_string(), tr_port.to_string());
                let restart = parse_restart_config(&params);

                let dir = terraria::instance_dir(&id.0);
                terraria::ensure_vanilla_instance_layout(&dir, &tr)?;
                let world_path = dir.join("worlds").join(format!("{}.wld", tr.world_name));
                let creating_world = !world_path.exists();
                let config_path = std::fs::canonicalize(dir.join("config").join("serverconfig.txt"))
                    .unwrap_or_else(|_| {
                        // Best-effort; even if canonicalize fails, pass the path we wrote.
                        dir.join("config").join("serverconfig.txt")
                    });

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("resolving terraria server zip...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] resolving terraria server zip".to_string())
                    .await;
                let resolved = terraria_download::resolve_server_zip(&tr.version).map_err(|e| {
                    crate::error_payload::anyhow(
                        "download_failed",
                        format!("failed to resolve terraria server zip: {e}"),
                        None,
                        Some("Check network connectivity, then try again.".to_string()),
                    )
                })?;
                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("downloading terraria server zip...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] downloading terraria server zip".to_string())
                    .await;
                let zip_path = terraria_download::ensure_server_zip(&resolved)
                    .await
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "download_failed",
                            format!("failed to download terraria server zip: {e}"),
                            None,
                            Some("Try again; if it persists, clear cache and retry.".to_string()),
                        )
                    })?;
                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("extracting terraria server files...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] extracting terraria server files".to_string())
                    .await;
                let extracted = terraria_download::extract_linux_x64_to_cache(
                    &zip_path,
                    &resolved.version_id,
                )
                .map_err(|e| {
                    crate::error_payload::anyhow(
                        "download_failed",
                        format!("failed to extract terraria server: {e}"),
                        None,
                        Some("Clear cache and retry extraction.".to_string()),
                    )
                })?;

                // Terraria expects sidecar files next to the binary.
                // Run from the extracted server root, but use instance-local config/world paths.
                // Prefer the native binary over the launcher script to avoid shebang/CRLF issues.
                let exec_path = &extracted.bin_x86_64;
                let missing = check_ldd_missing(exec_path)?;
                if !missing.is_empty() {
                    return Err(crate::error_payload::anyhow(
                        "missing_dependency",
                        format!("terraria runtime dependencies missing:\n{}", missing.join("\n")),
                        None,
                        Some(
                            "Update the Docker image, or install the listed libraries on the host."
                                .to_string(),
                        ),
                    ));
                }

                let mut cmd = Command::new(exec_path);
                let ld_library_path = format!(
                    "{}:{}:{}",
                    extracted.server_root.join("lib64").display(),
                    extracted.server_root.display(),
                    std::env::var("LD_LIBRARY_PATH").unwrap_or_default()
                );
                cmd.current_dir(&extracted.server_root)
                    .env("TERM", "xterm")
                    .env("LD_LIBRARY_PATH", &ld_library_path)
                    .arg("-config")
                    .arg(&config_path)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());

                let started_at_unix_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let mut env = collect_safe_env();
                env.insert("TERM".to_string(), "xterm".to_string());
                env.insert("LD_LIBRARY_PATH".to_string(), ld_library_path.clone());

                let args = vec!["-config".to_string(), config_path.display().to_string()];
                let mut run = RunInfo {
                    process_id: id.0.clone(),
                    template_id: t.template_id.clone(),
                    started_at_unix_ms,
                    agent_version: env!("CARGO_PKG_VERSION").to_string(),
                    pid: None,
                    pgid: None,
                    exec: exec_path.display().to_string(),
                    args: args.clone(),
                    cwd: extracted.server_root.display().to_string(),
                    params: redact_params(params.clone()),
                    env,
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!(
                    "[alloy-agent] terraria exec: {} {} (cwd {}) port={} version={}",
                    exec_path.display(),
                    args.join(" "),
                    extracted.server_root.display(),
                    tr.port,
                    resolved.version_id
                ))
                .await;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some(format!("spawning terraria server (port {})...", tr.port)),
                )
                .await;

                #[cfg(unix)]
                {
                    unsafe {
                        cmd.pre_exec(|| {
                            set_parent_death_signal()?;
                            if libc::setsid() == -1 {
                                return Err(std::io::Error::last_os_error());
                            }
                            Ok(())
                        });
                    }
                }

                let mut child = cmd
                    .spawn()
                    .with_context(|| {
                        format!(
                            "spawn terraria server: exec={} (cwd {})",
                            exec_path.display(),
                            extracted.server_root.display()
                        )
                    })
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "spawn_failed",
                            e.to_string(),
                            None,
                            Some(
                                "Ensure the Terraria server binary is executable and dependencies are installed."
                                    .to_string(),
                            ),
                        )
                    })?;
                let started = tokio::time::Instant::now();
                let pid_u32 = child.id();
                let pgid = pid_u32.map(|p| p as i32);

                run.pid = pid_u32;
                run.pgid = pgid;
                let _ = write_run_json(&dir, &run).await;

                let stdin = child.stdin.take();
                let stdout = child.stdout.take();
                let stderr = child.stderr.take();

                if let Some(out) = stdout {
                    let sink = sink.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(out).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            sink.emit(format!("[stdout] {line}")).await;
                        }
                    });
                }
                if let Some(err) = stderr {
                    let sink = sink.clone();
                    tokio::spawn(async move {
                        let mut lines = BufReader::new(err).lines();
                        while let Ok(Some(line)) = lines.next_line().await {
                            sink.emit(format!("[stderr] {line}")).await;
                        }
                    });
                }

                {
                    let mut inner = self.inner.lock().await;
                    inner.insert(
                        id.0.clone(),
                        ProcessEntry {
                            template_id: ProcessTemplateId(t.template_id.clone()),
                            state: ProcessState::Starting,
                            pid: pid_u32,
                            resources: None,
                            exit_code: None,
                            message: Some(format!("waiting for port {}...", tr.port)),
                            restart,
                            restart_attempts: reused_restart_attempts,
                            stdin,
                            graceful_stdin: t.graceful_stdin.clone(),
                            pgid,
                            logs: logs.clone(),
                            log_file_tx: Some(log_tx.clone()),
                        },
                    );
                }

                if let Some(pid) = pid_u32 {
                    self.spawn_resource_sampler(id.0.clone(), pid);
                }

                let manager = self.clone();
                let inner = self.inner.clone();
                let id_str = id.0.clone();

                // Port probe: only mark Running once the server actually listens.
                let probe_sink = sink.clone();
                let port = tr.port;
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    async move {
                        let timeout = if creating_world {
                            Duration::from_millis(
                                env_u64("ALLOY_TERRARIA_AUTOCREATE_PORT_PROBE_TIMEOUT_MS")
                                    .map(|v| v.clamp(1000, 10 * 60 * 1000))
                                    .unwrap_or(10 * 60 * 1000),
                            )
                        } else {
                            port_probe_timeout()
                        };
                        let ok = wait_for_local_tcp_port(port, timeout).await;

                        let (pgid, should_kill) = {
                            let mut map = inner.lock().await;
                            let Some(e) = map.get_mut(&id_str) else {
                                return;
                            };
                            if e.pid != pid_u32 || !matches!(e.state, ProcessState::Starting) {
                                return;
                            }

                            if ok {
                                e.state = ProcessState::Running;
                                e.message = None;
                                (e.pgid, false)
                            } else {
                                e.state = ProcessState::Failed;
                                e.message = Some(format!(
                                    "port {} did not open within {}ms",
                                    port,
                                    timeout.as_millis()
                                ));
                                (e.pgid, true)
                            }
                        };

                        if ok {
                            probe_sink
                                .emit(format!(
                                    "[alloy-agent] terraria port {} is accepting connections",
                                    port
                                ))
                                .await;
                        } else {
                            probe_sink
                                .emit(format!(
                                    "[alloy-agent] terraria port {} did not open in time",
                                    port
                                ))
                                .await;
                            if should_kill && let Some(pgid) = pgid {
                                #[cfg(unix)]
                                unsafe {
                                    libc::kill(-pgid, libc::SIGTERM);
                                }
                            }
                        }
                    }
                });

                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    let runtime = tokio::time::Instant::now().duration_since(started);

                    let mut restart_after: Option<Duration> = None;
                    let mut restart_attempt: u32 = 0;

                    let (final_state, exit_code) = {
                        let mut map = inner.lock().await;
                        let Some(e) = map.get_mut(&id_str) else {
                            return;
                        };

                        e.stdin = None;
                        let stopping = matches!(e.state, ProcessState::Stopping);

                        match res {
                            Ok(status) => {
                                e.exit_code = status.code();

                                if stopping {
                                    e.state = ProcessState::Exited;
                                    e.message = Some("stopped".to_string());
                                } else if runtime < early_exit_threshold() {
                                    e.state = ProcessState::Failed;
                                    e.message = Some(format!(
                                        "exited too quickly ({}ms)",
                                        runtime.as_millis()
                                    ));
                                } else if status.success() {
                                    e.state = ProcessState::Exited;
                                    e.message = Some("exited".to_string());
                                } else {
                                    e.state = ProcessState::Failed;
                                    e.message = Some(format!(
                                        "exited with code {}",
                                        status.code().unwrap_or_default()
                                    ));
                                }
                            }
                            Err(err) => {
                                e.state = ProcessState::Failed;
                                e.message = Some(format!("wait failed: {err}"));
                            }
                        }

                        if !stopping {
                            let is_failure = matches!(e.state, ProcessState::Failed)
                                || e.exit_code.is_some_and(|c| c != 0);
                            let should_restart = match e.restart.policy {
                                RestartPolicy::Off => false,
                                RestartPolicy::Always => true,
                                RestartPolicy::OnFailure => is_failure,
                            };

                            if should_restart && e.restart_attempts < e.restart.max_retries {
                                e.restart_attempts = e.restart_attempts.saturating_add(1);
                                let delay_ms = compute_backoff_ms(e.restart, e.restart_attempts);
                                restart_after = Some(Duration::from_millis(delay_ms));
                                restart_attempt = e.restart_attempts;
                                e.message = Some(format!(
                                    "restarting in {}ms (attempt {}/{})",
                                    delay_ms, restart_attempt, e.restart.max_retries
                                ));
                            }
                        }

                        (e.state, e.exit_code)
                    };

                    wait_sink
                        .emit(format!(
                            "[alloy-agent] process exited: state={:?} exit_code={:?} runtime_ms={}",
                            final_state,
                            exit_code,
                            runtime.as_millis()
                        ))
                        .await;

                    if let Some(delay) = restart_after {
                        wait_sink
                            .emit(format!(
                                "[alloy-agent] auto-restart scheduled in {}ms (attempt {})",
                                delay.as_millis(),
                                restart_attempt
                            ))
                            .await;
                        let handle = tokio::runtime::Handle::current();
                        let wait_sink = wait_sink.clone();
                        tokio::task::spawn_blocking(move || {
                            std::thread::sleep(delay);
                            let res = handle.block_on(manager.start_from_template_with_process_id(
                                &id_str,
                                &template_id,
                                params_for_restart,
                            ));
                            match res {
                                Ok(st) if matches!(st.state, ProcessState::Failed) => {
                                    let msg = st
                                        .message
                                        .filter(|s| !s.trim().is_empty())
                                        .unwrap_or_else(|| "unknown error".to_string());
                                    handle.block_on(wait_sink.emit(format!(
                                        "[alloy-agent] auto-restart failed: {msg}"
                                    )));
                                }
                                Ok(_) => {
                                    handle.block_on(wait_sink.emit(
                                        "[alloy-agent] auto-restart triggered".to_string(),
                                    ));
                                }
                                Err(err) => {
                                    handle.block_on(wait_sink.emit(format!(
                                        "[alloy-agent] auto-restart failed: {err}"
                                    )));
                                }
                            }
                        });
                    }
                });

                return Ok(ProcessStatus {
                    id: id.clone(),
                    template_id: ProcessTemplateId(t.template_id.clone()),
                    state: ProcessState::Starting,
                    pid: pid_u32,
                    exit_code: None,
                    message: Some(format!("waiting for port {}...", tr.port)),
                    resources: None,
                });
            }

            let mut cmd = Command::new(&t.command);
            let exec = t.command.clone();
            let args = t.args.clone();
            let restart = parse_restart_config(&params);
            cmd.args(&args)
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            let cwd = std::env::current_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "<unknown>".to_string());

            let started_at_unix_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let mut run = RunInfo {
                process_id: id.0.clone(),
                template_id: t.template_id.clone(),
                started_at_unix_ms,
                agent_version: env!("CARGO_PKG_VERSION").to_string(),
                pid: None,
                pgid: None,
                exec: exec.clone(),
                args: args.clone(),
                cwd: cwd.clone(),
                params: redact_params(params.clone()),
                env: collect_safe_env(),
            };
            let _ = write_run_json(&root_dir, &run).await;

            sink.emit(format!(
                "[alloy-agent] exec: {} {} (cwd {})",
                exec,
                args.join(" "),
                cwd
            ))
            .await;

            #[cfg(unix)]
            {
                unsafe {
                    cmd.pre_exec(|| {
                        // Start a new session so we can signal the whole process tree.
                        set_parent_death_signal()?;
                        if libc::setsid() == -1 {
                            return Err(std::io::Error::last_os_error());
                        }
                        Ok(())
                    });
                }
            }

            let mut child = cmd
                .spawn()
                .with_context(|| format!("spawn process: exec={exec} (cwd {cwd})"))
                .map_err(|e| {
                    crate::error_payload::anyhow(
                        "spawn_failed",
                        e.to_string(),
                        None,
                        Some("Ensure the command exists and is executable.".to_string()),
                    )
                })?;
            let started = tokio::time::Instant::now();
            let pid_u32 = child.id();
            let pgid = pid_u32.map(|p| p as i32);

            run.pid = pid_u32;
            run.pgid = pgid;
            let _ = write_run_json(&root_dir, &run).await;

            let stdin = child.stdin.take();
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            if let Some(out) = stdout {
                let sink = sink.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(out).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        sink.emit(format!("[stdout] {line}")).await;
                    }
                });
            }
            if let Some(err) = stderr {
                let sink = sink.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(err).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        sink.emit(format!("[stderr] {line}")).await;
                    }
                });
            }

            {
                let mut inner = self.inner.lock().await;
                inner.insert(
                    id.0.clone(),
                    ProcessEntry {
                        template_id: ProcessTemplateId(t.template_id.clone()),
                        state: ProcessState::Running,
                        pid: pid_u32,
                        resources: None,
                        exit_code: None,
                        message: None,
                        restart,
                        restart_attempts: reused_restart_attempts,
                        stdin,
                        graceful_stdin: t.graceful_stdin.clone(),
                        pgid,
                        logs: logs.clone(),
                        log_file_tx: Some(log_tx.clone()),
                    },
                );
            }

            if let Some(pid) = pid_u32 {
                self.spawn_resource_sampler(id.0.clone(), pid);
            }

            let manager = self.clone();
            let inner = self.inner.clone();
            let id_str = id.0.clone();
            let wait_sink = sink.clone();
            let template_id = t.template_id.clone();
            let params_for_restart = params.clone();
            tokio::spawn(async move {
                let res = child.wait().await;
                let runtime = tokio::time::Instant::now().duration_since(started);

                let mut restart_after: Option<Duration> = None;
                let mut restart_attempt: u32 = 0;

                let (final_state, exit_code) = {
                    let mut map = inner.lock().await;
                    let Some(e) = map.get_mut(&id_str) else {
                        return;
                    };

                    e.stdin = None;
                    let stopping = matches!(e.state, ProcessState::Stopping);

                    match res {
                        Ok(status) => {
                            e.exit_code = status.code();

                            if stopping {
                                e.state = ProcessState::Exited;
                                e.message = Some("stopped".to_string());
                            } else if runtime < early_exit_threshold() {
                                e.state = ProcessState::Failed;
                                e.message =
                                    Some(format!("exited too quickly ({}ms)", runtime.as_millis()));
                            } else if status.success() {
                                e.state = ProcessState::Exited;
                                e.message = Some("exited".to_string());
                            } else {
                                e.state = ProcessState::Failed;
                                e.message = Some(format!(
                                    "exited with code {}",
                                    status.code().unwrap_or_default()
                                ));
                            }
                        }
                        Err(err) => {
                            e.state = ProcessState::Failed;
                            e.message = Some(format!("wait failed: {err}"));
                        }
                    }

                    if !stopping {
                        let is_failure = matches!(e.state, ProcessState::Failed)
                            || e.exit_code.is_some_and(|c| c != 0);
                        let should_restart = match e.restart.policy {
                            RestartPolicy::Off => false,
                            RestartPolicy::Always => true,
                            RestartPolicy::OnFailure => is_failure,
                        };

                        if should_restart && e.restart_attempts < e.restart.max_retries {
                            e.restart_attempts = e.restart_attempts.saturating_add(1);
                            let delay_ms = compute_backoff_ms(e.restart, e.restart_attempts);
                            restart_after = Some(Duration::from_millis(delay_ms));
                            restart_attempt = e.restart_attempts;
                            e.message = Some(format!(
                                "restarting in {}ms (attempt {}/{})",
                                delay_ms, restart_attempt, e.restart.max_retries
                            ));
                        }
                    }

                    (e.state, e.exit_code)
                };

                wait_sink
                    .emit(format!(
                        "[alloy-agent] process exited: state={:?} exit_code={:?} runtime_ms={}",
                        final_state,
                        exit_code,
                        runtime.as_millis()
                    ))
                    .await;

                if let Some(delay) = restart_after {
                    wait_sink
                        .emit(format!(
                            "[alloy-agent] auto-restart scheduled in {}ms (attempt {})",
                            delay.as_millis(),
                            restart_attempt
                        ))
                        .await;
                    let handle = tokio::runtime::Handle::current();
                    let wait_sink = wait_sink.clone();
                    tokio::task::spawn_blocking(move || {
                        std::thread::sleep(delay);
                        let res = handle.block_on(manager.start_from_template_with_process_id(
                            &id_str,
                            &template_id,
                            params_for_restart,
                        ));
                        match res {
                            Ok(st) if matches!(st.state, ProcessState::Failed) => {
                                let msg = st
                                    .message
                                    .filter(|s| !s.trim().is_empty())
                                    .unwrap_or_else(|| "unknown error".to_string());
                                handle.block_on(
                                    wait_sink
                                        .emit(format!("[alloy-agent] auto-restart failed: {msg}")),
                                );
                            }
                            Ok(_) => {
                                handle.block_on(
                                    wait_sink
                                        .emit("[alloy-agent] auto-restart triggered".to_string()),
                                );
                            }
                            Err(err) => {
                                handle.block_on(
                                    wait_sink
                                        .emit(format!("[alloy-agent] auto-restart failed: {err}")),
                                );
                            }
                        }
                    });
                }
            });

            Ok(ProcessStatus {
                id: id.clone(),
                template_id: ProcessTemplateId(t.template_id.clone()),
                state: ProcessState::Running,
                pid: pid_u32,
                exit_code: None,
                message: None,
                resources: None,
            })
        }
        .await;

        match result {
            Ok(st) => Ok(st),
            Err(err) => {
                sink.emit(format!("[alloy-agent] start failed: {err}"))
                    .await;

                let msg = err.to_string();
                let restart = parse_restart_config(&params);

                {
                    let mut inner = self.inner.lock().await;
                    inner.insert(
                        id.0.clone(),
                        ProcessEntry {
                            template_id: ProcessTemplateId(t.template_id.clone()),
                            state: ProcessState::Failed,
                            pid: None,
                            resources: None,
                            exit_code: None,
                            message: Some(msg.clone()),
                            restart,
                            restart_attempts: reused_restart_attempts,
                            stdin: None,
                            graceful_stdin: t.graceful_stdin.clone(),
                            pgid: None,
                            logs: logs.clone(),
                            log_file_tx: Some(log_tx.clone()),
                        },
                    );
                }

                Ok(ProcessStatus {
                    id,
                    template_id: ProcessTemplateId(t.template_id.clone()),
                    state: ProcessState::Failed,
                    pid: None,
                    exit_code: None,
                    message: Some(msg),
                    resources: None,
                })
            }
        }
    }

    pub async fn list_templates(&self) -> Vec<templates::ProcessTemplate> {
        templates::list_templates()
    }

    pub async fn list_processes(&self) -> Vec<ProcessStatus> {
        let inner = self.inner.lock().await;
        inner
            .iter()
            .map(|(id, e)| ProcessStatus {
                id: ProcessId(id.clone()),
                template_id: e.template_id.clone(),
                state: e.state,
                pid: e.pid,
                exit_code: e.exit_code,
                message: e.message.clone(),
                resources: e.resources.clone(),
            })
            .collect()
    }

    pub async fn get_status(&self, process_id: &str) -> Option<ProcessStatus> {
        let inner = self.inner.lock().await;
        inner.get(process_id).map(|e| ProcessStatus {
            id: ProcessId(process_id.to_string()),
            template_id: e.template_id.clone(),
            state: e.state,
            pid: e.pid,
            exit_code: e.exit_code,
            message: e.message.clone(),
            resources: e.resources.clone(),
        })
    }

    pub async fn start_from_template(
        &self,
        template_id: &str,
        params: BTreeMap<String, String>,
    ) -> anyhow::Result<ProcessStatus> {
        let id = ProcessId::new();
        self.start_from_template_with_process_id(&id.0, template_id, params)
            .await
    }

    pub async fn stop(&self, process_id: &str, timeout: Duration) -> anyhow::Result<ProcessStatus> {
        // Phase 1 policy:
        // - If template defines `graceful_stdin`, send it first and give the process time.
        // - Otherwise, send SIGTERM immediately.
        // - Always escalate: SIGTERM (fallback) -> SIGKILL at the end of timeout.

        let mut graceful_sent = false;
        let mut term_sent = false;
        let template_id: String;
        let pgid: Option<i32>;
        let logs: Arc<Mutex<LogBuffer>>;
        let log_tx: Option<mpsc::UnboundedSender<String>>;
        let mut graceful: Option<(ChildStdin, String)> = None;

        {
            let mut inner = self.inner.lock().await;
            let e = inner
                .get_mut(process_id)
                .ok_or_else(|| anyhow::anyhow!("unknown process_id: {process_id}"))?;

            if matches!(e.state, ProcessState::Exited | ProcessState::Failed) {
                return Ok(ProcessStatus {
                    id: ProcessId(process_id.to_string()),
                    template_id: e.template_id.clone(),
                    state: e.state,
                    pid: e.pid,
                    exit_code: e.exit_code,
                    message: e.message.clone(),
                    resources: e.resources.clone(),
                });
            }

            template_id = e.template_id.0.clone();
            pgid = e.pgid;
            logs = e.logs.clone();
            log_tx = e.log_file_tx.clone();
            e.state = ProcessState::Stopping;
            e.message = Some("stopping".to_string());

            if let Some(stdin) = e.stdin.take()
                && let Some(cmd) = e.graceful_stdin.take()
            {
                graceful = Some((stdin, cmd));
            }
        }

        let emit = |line: String,
                    logs: Arc<Mutex<LogBuffer>>,
                    log_tx: Option<mpsc::UnboundedSender<String>>| async move {
            logs.lock().await.push_line(line.clone());
            if let Some(tx) = log_tx {
                let _ = tx.send(line);
            }
        };

        emit(
            format!(
                "[alloy-agent] stop requested (timeout_ms={})",
                timeout.as_millis()
            ),
            logs.clone(),
            log_tx.clone(),
        )
        .await;

        if let Some((mut stdin, cmd)) = graceful.take() {
            let _ = stdin.write_all(cmd.as_bytes()).await;
            let _ = stdin.flush().await;
            // Intentionally drop stdin so the child sees EOF.
            graceful_sent = true;
            emit(
                "[alloy-agent] stop: sent graceful stdin".to_string(),
                logs.clone(),
                log_tx.clone(),
            )
            .await;
        }

        // If we didn't have a graceful command, send SIGTERM right away.
        if !graceful_sent && let Some(pgid) = pgid {
            #[cfg(unix)]
            unsafe {
                libc::kill(-pgid, libc::SIGTERM);
            }
            term_sent = true;
            emit(
                "[alloy-agent] stop: sent SIGTERM".to_string(),
                logs.clone(),
                log_tx.clone(),
            )
            .await;
        }

        let start = tokio::time::Instant::now();
        let kill_deadline = start + timeout;
        // If we attempted graceful stdin, only send SIGTERM near the end.
        let term_deadline = if graceful_sent {
            kill_deadline
                .checked_sub(graceful_term_grace())
                .unwrap_or(start)
        } else {
            start
        };

        let mut save_cursor = if graceful_sent {
            logs.lock().await.next_seq.saturating_sub(1)
        } else {
            0
        };
        let mut save_confirmed = false;
        let mut save_timeout_warned = false;

        let save_keywords: &[&str] = match template_id.as_str() {
            "minecraft:vanilla" => &[
                "saved the game",
                "saving chunks for level",
                "all chunks are saved",
                "saving players",
            ],
            "terraria:vanilla" => &["saving world", "world saved"],
            _ => &[],
        };

        loop {
            if let Some(status) = self.get_status(process_id).await
                && matches!(status.state, ProcessState::Exited | ProcessState::Failed)
            {
                return Ok(status);
            }

            let now = tokio::time::Instant::now();

            if graceful_sent && !save_keywords.is_empty() && !save_confirmed {
                if now < term_deadline {
                    let (lines, next) = logs.lock().await.tail_after(save_cursor, 200);
                    save_cursor = next;
                    for line in &lines {
                        let lower = line.to_ascii_lowercase();
                        if save_keywords.iter().any(|k| lower.contains(k)) {
                            save_confirmed = true;
                            emit(
                                format!(
                                    "[alloy-agent] stop: world save confirmed ({})",
                                    save_keywords
                                        .iter()
                                        .find(|k| lower.contains(*k))
                                        .unwrap_or(&"matched")
                                ),
                                logs.clone(),
                                log_tx.clone(),
                            )
                            .await;
                            let mut inner = self.inner.lock().await;
                            if let Some(e) = inner.get_mut(process_id) {
                                e.message = Some("stopping (world saved)".to_string());
                            }
                            break;
                        }
                    }
                } else if !save_timeout_warned {
                    save_timeout_warned = true;
                    emit(
                        "[alloy-agent] stop: world save not confirmed before timeout window; shutdown may risk data loss"
                            .to_string(),
                        logs.clone(),
                        log_tx.clone(),
                    )
                    .await;
                    let mut inner = self.inner.lock().await;
                    if let Some(e) = inner.get_mut(process_id) {
                        e.message = Some("stopping (save not confirmed)".to_string());
                    }
                }
            }

            if !term_sent
                && now >= term_deadline
                && let Some(pgid) = pgid
            {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-pgid, libc::SIGTERM);
                }
                term_sent = true;
                emit(
                    "[alloy-agent] stop: sent SIGTERM (late)".to_string(),
                    logs.clone(),
                    log_tx.clone(),
                )
                .await;
            }

            if now >= kill_deadline {
                // Escalate to SIGKILL.
                let mut killed = false;
                let mut inner = self.inner.lock().await;
                if let Some(e) = inner.get_mut(process_id)
                    && let Some(pgid) = e.pgid
                {
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                    e.message = Some("killed after timeout".to_string());
                    killed = true;
                }
                drop(inner);
                if killed {
                    emit(
                        "[alloy-agent] stop: sent SIGKILL (timeout)".to_string(),
                        logs.clone(),
                        log_tx.clone(),
                    )
                    .await;
                }
                break;
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Return best-effort status.
        self.get_status(process_id)
            .await
            .ok_or_else(|| anyhow::anyhow!("unknown process_id: {process_id}"))
    }

    pub async fn tail_logs(
        &self,
        process_id: &str,
        cursor: u64,
        limit: usize,
    ) -> anyhow::Result<(Vec<String>, u64)> {
        let logs = {
            let inner = self.inner.lock().await;
            let e = inner
                .get(process_id)
                .ok_or_else(|| anyhow::anyhow!("unknown process_id: {process_id}"))?;
            e.logs.clone()
        };

        let guard = logs.lock().await;
        Ok(guard.tail_after(cursor, limit))
    }
}
