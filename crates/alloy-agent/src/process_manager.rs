use std::{
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::Arc,
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

use crate::dst;
use crate::dst_download;
use crate::minecraft;
use crate::minecraft_curseforge;
use crate::minecraft_download;
use crate::minecraft_import;
use crate::minecraft_launch;
use crate::minecraft_modrinth;
use crate::port_alloc;
use crate::sandbox;
use crate::templates;
use crate::terraria;
use crate::terraria_download;
use crate::process_manager_support::{
    RestartConfig,
    RestartPolicy,
    compute_backoff_ms,
    early_exit_threshold,
    env_u64,
    format_error_chain,
    log_file_limits,
    log_max_lines,
    parse_restart_config,
    port_probe_timeout,
    read_proc_cpu_ticks,
    read_proc_rss_bytes,
    resource_sample_interval,
    ticks_per_sec,
};

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

fn materialize_minecraft_server_jar(instance_jar: &Path, cached_jar: &Path) -> anyhow::Result<()> {
    match std::fs::symlink_metadata(instance_jar) {
        Ok(meta) => {
            if meta.is_dir() {
                anyhow::bail!(
                    "invalid instance server.jar path: {} is a directory",
                    instance_jar.display()
                );
            }
            std::fs::remove_file(instance_jar)
                .with_context(|| format!("remove existing {}", instance_jar.display()))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => {
            return Err(e).with_context(|| format!("stat {}", instance_jar.display()));
        }
    }

    match std::fs::hard_link(cached_jar, instance_jar) {
        Ok(()) => Ok(()),
        Err(_) => {
            let tmp = instance_jar.with_extension(format!("jar.tmp.{}", std::process::id()));
            std::fs::copy(cached_jar, &tmp).with_context(|| {
                format!(
                    "copy minecraft server.jar from {} to {}",
                    cached_jar.display(),
                    tmp.display()
                )
            })?;
            std::fs::rename(&tmp, instance_jar).with_context(|| {
                format!(
                    "move minecraft server.jar from {} to {}",
                    tmp.display(),
                    instance_jar.display()
                )
            })?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        materialize_minecraft_server_jar, parse_java_major_from_version_line, patch_frp_config,
    };
    use std::{
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_dir_for(test_name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "alloy-agent-{test_name}-{}-{n}-{ts}",
            std::process::id()
        ));
        dir
    }

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

    #[test]
    fn patch_frp_ini_updates_local_and_remote_port() {
        let raw = r#"[common]
server_addr = frp.example.com
server_port = 7000

[game]
type = tcp
local_ip = 0.0.0.0
local_port = 25565
remote_port = 0
"#;
        let patched = patch_frp_config(raw, 25577);
        assert!(patched.contains("local_ip = 127.0.0.1"));
        assert!(patched.contains("local_port = 25577"));
        assert!(patched.contains("remote_port = 25577"));
    }

    #[test]
    fn patch_frp_ini_uses_allocatable_ports_hint() {
        let raw = r#"[common]
server_addr = frp.example.com
server_port = 7000
# alloy_alloc_ports = 30010,30011,30012

[game]
type = tcp
local_port = 25565
remote_port = 0
"#;
        let patched = patch_frp_config(raw, 25577);
        assert!(patched.contains("remote_port = 30012"));
    }

    #[test]
    fn patch_frp_json_is_converted_and_patched() {
        let raw = r#"{
  "common": {
    "server_addr": "frp.example.com",
    "server_port": 7000
  },
  "game": {
    "type": "tcp",
    "local_port": 25565,
    "remote_port": 0
  }
}"#;
        let patched = patch_frp_config(raw, 26666);
        assert!(patched.contains("[common]"));
        assert!(patched.contains("server_addr = frp.example.com"));
        assert!(patched.contains("[game]"));
        assert!(patched.contains("local_port = 26666"));
        assert!(patched.contains("remote_port = 26666"));
    }

    #[test]
    fn patch_frp_yaml_is_converted_and_patched() {
        let raw = r#"
common:
  server_addr: frp.example.com
  server_port: 7000
proxies:
  - name: game
    type: tcp
    local_port: 25565
    remote_port: 0
"#;
        let patched = patch_frp_config(raw, 27777);
        assert!(patched.contains("[game]"));
        assert!(patched.contains("local_port = 27777"));
        assert!(patched.contains("remote_port = 27777"));
    }

    #[test]
    fn materialize_server_jar_replaces_existing_file() {
        let root = temp_dir_for("materialize-server-jar-file");
        std::fs::create_dir_all(&root).unwrap();

        let cache = root.join("cache-server.jar");
        let instance_jar = root.join("server.jar");

        std::fs::write(&cache, b"fresh-jar").unwrap();
        std::fs::write(&instance_jar, b"stale-jar").unwrap();

        materialize_minecraft_server_jar(&instance_jar, &cache).unwrap();

        let got = std::fs::read(&instance_jar).unwrap();
        assert_eq!(got, b"fresh-jar");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[cfg(unix)]
    #[test]
    fn materialize_server_jar_replaces_existing_symlink() {
        let root = temp_dir_for("materialize-server-jar-symlink");
        std::fs::create_dir_all(&root).unwrap();

        let cache = root.join("cache-server.jar");
        let stale = root.join("stale-server.jar");
        let instance_jar = root.join("server.jar");

        std::fs::write(&cache, b"fresh-jar").unwrap();
        std::fs::write(&stale, b"stale-jar").unwrap();
        std::os::unix::fs::symlink(&stale, &instance_jar).unwrap();

        materialize_minecraft_server_jar(&instance_jar, &cache).unwrap();

        let meta = std::fs::symlink_metadata(&instance_jar).unwrap();
        assert!(!meta.file_type().is_symlink());
        let got = std::fs::read(&instance_jar).unwrap();
        assert_eq!(got, b"fresh-jar");

        let _ = std::fs::remove_dir_all(&root);
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
    #[serde(skip_serializing_if = "Option::is_none")]
    container_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    container_id: Option<String>,
    exec: String,
    args: Vec<String>,
    cwd: String,
    // Params are redacted for known secret keys.
    params: BTreeMap<String, String>,
    env: BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct RunContainerMeta {
    container_name: Option<String>,
    container_id: Option<String>,
}

fn redact_params(mut params: BTreeMap<String, String>) -> BTreeMap<String, String> {
    for (k, v) in params.iter_mut() {
        let key = k.to_ascii_lowercase();
        let is_secret = key.contains("password")
            || key.contains("token")
            || key.contains("secret")
            || key.contains("api_key")
            || key.contains("apikey")
            || (key.contains("frp") && key.contains("config"));
        if is_secret && !v.is_empty() {
            *v = "<redacted>".to_string();
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FrpConfigFormat {
    Ini,
    Json,
    Toml,
    Yaml,
}

fn detect_frp_config_format(raw: &str) -> FrpConfigFormat {
    let s = raw.trim();
    if s.is_empty() {
        return FrpConfigFormat::Ini;
    }
    if serde_json::from_str::<serde_json::Value>(s).is_ok() {
        return FrpConfigFormat::Json;
    }
    if s.parse::<toml::Value>().is_ok() {
        return FrpConfigFormat::Toml;
    }
    if serde_yaml::from_str::<serde_yaml::Value>(s).is_ok() {
        return FrpConfigFormat::Yaml;
    }
    FrpConfigFormat::Ini
}

fn parse_port_scalar(raw: &str) -> Option<u16> {
    let s = raw.trim().trim_matches('"').trim_matches('\'');
    let p = s.parse::<u16>().ok()?;
    if p == 0 {
        return None;
    }
    Some(p)
}

fn parse_allocatable_ports_spec(raw: &str) -> Vec<u16> {
    let mut out = BTreeSet::<u16>::new();
    for seg in raw.split(',') {
        let token = seg.trim();
        if token.is_empty() {
            continue;
        }
        if let Some((a_raw, b_raw)) = token.split_once('-') {
            let Some(a) = parse_port_scalar(a_raw) else {
                continue;
            };
            let Some(b) = parse_port_scalar(b_raw) else {
                continue;
            };
            let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
            if hi.saturating_sub(lo) > 4000 {
                continue;
            }
            for p in lo..=hi {
                out.insert(p);
                if out.len() > 4000 {
                    break;
                }
            }
        } else if let Some(port) = parse_port_scalar(token) {
            out.insert(port);
        }
        if out.len() > 4000 {
            break;
        }
    }
    out.into_iter().collect()
}

fn parse_allocatable_ports_hint(raw: &str) -> Vec<u16> {
    for line in raw.lines() {
        let s = line.trim();
        if s.is_empty() {
            continue;
        }
        let body = s
            .strip_prefix('#')
            .or_else(|| s.strip_prefix(';'))
            .or_else(|| s.strip_prefix("//"))
            .map(str::trim)
            .unwrap_or(s);
        if let Some((k, v)) = body.split_once('=') {
            let key = k.trim().to_ascii_lowercase();
            if key == "alloy_alloc_ports" || key == "allocatable_ports" {
                return parse_allocatable_ports_spec(v);
            }
        }
        if let Some((k, v)) = body.split_once(':') {
            let key = k.trim().to_ascii_lowercase();
            if key == "alloy_alloc_ports" || key == "allocatable_ports" {
                return parse_allocatable_ports_spec(v);
            }
        }
    }
    Vec::new()
}

fn choose_remote_port(explicit: Option<u16>, alloc_ports: &[u16], local_port: u16) -> u16 {
    if let Some(v) = explicit {
        return v;
    }
    if alloc_ports.is_empty() {
        return local_port;
    }
    let idx = usize::from(local_port) % alloc_ports.len();
    alloc_ports[idx]
}

fn normalize_ini_scalar_value(raw: &str) -> String {
    raw.trim()
        .split(['#', ';'])
        .next()
        .unwrap_or("")
        .trim()
        .trim_matches('"')
        .trim_matches('\'')
        .to_string()
}

fn patch_frpc_ini(raw: &str, local_port: u16, alloc_ports_hint: &[u16]) -> String {
    let mut explicit_remote_port: Option<u16> = None;
    for line in raw.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with('#') || trimmed.starts_with(';') {
            continue;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower.starts_with("remote_port") {
            let rest = trimmed
                .get("remote_port".len()..)
                .unwrap_or("")
                .trim_start();
            if rest.is_empty() || rest.starts_with('=') || rest.starts_with(':') {
                if let Some((_, v_raw)) = trimmed.split_once('=') {
                    explicit_remote_port = parse_port_scalar(&normalize_ini_scalar_value(v_raw));
                } else if let Some((_, v_raw)) = trimmed.split_once(':') {
                    explicit_remote_port = parse_port_scalar(&normalize_ini_scalar_value(v_raw));
                }
            }
        }
    }

    let remote_port = choose_remote_port(explicit_remote_port, alloc_ports_hint, local_port);

    let mut out = String::with_capacity(raw.len().saturating_add(64));
    let port = local_port.to_string();
    let remote_port_str = remote_port.to_string();

    for line in raw.lines() {
        let trimmed = line.trim_start();

        if trimmed.starts_with('#') || trimmed.starts_with(';') {
            out.push_str(line);
            out.push('\n');
            continue;
        }

        let lower = trimmed.to_ascii_lowercase();
        let indent_len = line.len().saturating_sub(trimmed.len());
        let indent = &line[..indent_len];

        if lower.starts_with("local_port") {
            let rest = trimmed.get("local_port".len()..).unwrap_or("").trim_start();
            if rest.is_empty() || rest.starts_with('=') || rest.starts_with(':') {
                out.push_str(indent);
                out.push_str("local_port = ");
                out.push_str(&port);
                out.push('\n');
                continue;
            }
        }

        if lower.starts_with("local_ip") {
            let rest = trimmed.get("local_ip".len()..).unwrap_or("").trim_start();
            if rest.is_empty() || rest.starts_with('=') || rest.starts_with(':') {
                out.push_str(indent);
                out.push_str("local_ip = 127.0.0.1\n");
                continue;
            }
        }

        if lower.starts_with("remote_port") {
            let rest = trimmed
                .get("remote_port".len()..)
                .unwrap_or("")
                .trim_start();
            if rest.is_empty() || rest.starts_with('=') || rest.starts_with(':') {
                out.push_str(indent);
                out.push_str("remote_port = ");
                out.push_str(&remote_port_str);
                out.push('\n');
                continue;
            }
        }

        out.push_str(line);
        out.push('\n');
    }

    out
}

fn json_scalar_to_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(if *b { "true" } else { "false" }.to_string()),
        _ => None,
    }
}

fn patch_structured_frp_to_ini(
    root: serde_json::Value,
    local_port: u16,
    alloc_ports_hint: &[u16],
) -> Option<String> {
    let obj = root.as_object()?;

    let mut common = BTreeMap::<String, String>::new();
    if let Some(common_obj) = obj.get("common").and_then(|v| v.as_object()) {
        for (k, v) in common_obj {
            if let Some(s) = json_scalar_to_string(v) {
                common.insert(k.clone(), s);
            }
        }
    }

    let mut alloc_ports = common
        .get("alloy_alloc_ports")
        .map(|s| parse_allocatable_ports_spec(s))
        .filter(|v| !v.is_empty())
        .or_else(|| {
            common
                .get("allocatable_ports")
                .map(|s| parse_allocatable_ports_spec(s))
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_else(|| alloc_ports_hint.to_vec());
    if alloc_ports.is_empty() {
        alloc_ports = alloc_ports_hint.to_vec();
    }

    let mut proxies: Vec<(String, BTreeMap<String, String>)> = Vec::new();

    for (k, v) in obj {
        if k == "common" || k == "proxies" {
            continue;
        }
        let Some(m) = v.as_object() else {
            continue;
        };
        let mut vals = BTreeMap::<String, String>::new();
        for (kk, vv) in m {
            if let Some(s) = json_scalar_to_string(vv) {
                vals.insert(kk.clone(), s);
            }
        }
        proxies.push((k.clone(), vals));
    }

    if let Some(arr) = obj.get("proxies").and_then(|v| v.as_array()) {
        for (idx, item) in arr.iter().enumerate() {
            let Some(m) = item.as_object() else {
                continue;
            };
            let mut vals = BTreeMap::<String, String>::new();
            for (kk, vv) in m {
                if let Some(s) = json_scalar_to_string(vv) {
                    vals.insert(kk.clone(), s);
                }
            }
            let name = vals
                .get("name")
                .cloned()
                .filter(|s| !s.trim().is_empty())
                .unwrap_or_else(|| format!("proxy{}", idx + 1));
            proxies.push((name, vals));
        }
    }

    if proxies.is_empty() {
        proxies.push(("alloy".to_string(), BTreeMap::new()));
    }

    for (_, vals) in proxies.iter_mut() {
        let explicit_remote = vals
            .get("remote_port")
            .and_then(|v| parse_port_scalar(v))
            .or_else(|| vals.get("remotePort").and_then(|v| parse_port_scalar(v)));
        let remote = choose_remote_port(explicit_remote, &alloc_ports, local_port);

        vals.remove("localIP");
        vals.remove("localPort");
        vals.remove("remotePort");
        vals.insert("local_ip".to_string(), "127.0.0.1".to_string());
        vals.insert("local_port".to_string(), local_port.to_string());
        vals.insert("remote_port".to_string(), remote.to_string());
        vals.entry("type".to_string())
            .or_insert_with(|| "tcp".to_string());
    }

    common.remove("alloy_alloc_ports");
    common.remove("allocatable_ports");

    let mut out = String::new();
    out.push_str("[common]\n");
    for (k, v) in common {
        out.push_str(&format!("{k} = {v}\n"));
    }
    if !alloc_ports.is_empty() {
        let spec = alloc_ports
            .iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(",");
        out.push_str(&format!("# alloy_alloc_ports = {spec}\n"));
    }

    for (name, vals) in proxies {
        out.push('\n');
        out.push_str(&format!("[{name}]\n"));
        for (k, v) in vals {
            out.push_str(&format!("{k} = {v}\n"));
        }
    }

    Some(out)
}

fn patch_frp_config(raw: &str, local_port: u16) -> String {
    let format = detect_frp_config_format(raw);
    let alloc_ports_hint = parse_allocatable_ports_hint(raw);

    match format {
        FrpConfigFormat::Ini => patch_frpc_ini(raw, local_port, &alloc_ports_hint),
        FrpConfigFormat::Json => serde_json::from_str::<serde_json::Value>(raw)
            .ok()
            .and_then(|root| patch_structured_frp_to_ini(root, local_port, &alloc_ports_hint))
            .unwrap_or_else(|| patch_frpc_ini(raw, local_port, &alloc_ports_hint)),
        FrpConfigFormat::Toml => raw
            .parse::<toml::Value>()
            .ok()
            .and_then(|v| serde_json::to_value(v).ok())
            .and_then(|root| patch_structured_frp_to_ini(root, local_port, &alloc_ports_hint))
            .unwrap_or_else(|| patch_frpc_ini(raw, local_port, &alloc_ports_hint)),
        FrpConfigFormat::Yaml => serde_yaml::from_str::<serde_yaml::Value>(raw)
            .ok()
            .and_then(|v| serde_json::to_value(v).ok())
            .and_then(|root| patch_structured_frp_to_ini(root, local_port, &alloc_ports_hint))
            .unwrap_or_else(|| patch_frpc_ini(raw, local_port, &alloc_ports_hint)),
    }
}

async fn start_frpc_sidecar(
    sink: LogSink,
    instance_dir: PathBuf,
    owner_pgid: i32,
    local_port: u16,
    config_raw: String,
) -> anyhow::Result<()> {
    let cfg_dir = instance_dir.join("config");
    let cfg_path = cfg_dir.join("frpc.ini");
    let detected = detect_frp_config_format(&config_raw);
    let patched = patch_frp_config(&config_raw, local_port);

    tokio::fs::create_dir_all(&cfg_dir)
        .await
        .context("create frpc config dir")?;

    let tmp = cfg_path.with_extension("ini.tmp");
    tokio::fs::write(&tmp, patched.as_bytes())
        .await
        .context("write frpc config tmp")?;
    tokio::fs::rename(&tmp, &cfg_path)
        .await
        .context("persist frpc config")?;

    let exec = std::env::var("ALLOY_FRPC_PATH").unwrap_or_else(|_| "frpc".to_string());

    sink.emit(format!(
        "[alloy-agent] starting frpc tunnel (local_port={local_port}, source={detected:?})"
    ))
    .await;

    let mut cmd = Command::new(&exec);
    cmd.current_dir(&instance_dir)
        .arg("-c")
        .arg(&cfg_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(unix)]
    {
        unsafe {
            cmd.pre_exec(move || {
                set_parent_death_signal()?;
                if libc::setpgid(0, owner_pgid) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }

    let mut child = cmd
        .spawn()
        .with_context(|| format!("spawn frpc: exec={exec} (cfg {})", cfg_path.display()))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    if let Some(out) = stdout {
        let sink = sink.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(out).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                sink.emit(format!("[frpc stdout] {line}")).await;
            }
        });
    }
    if let Some(err) = stderr {
        let sink = sink.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(err).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                sink.emit(format!("[frpc stderr] {line}")).await;
            }
        });
    }

    let wait_sink = sink.clone();
    tokio::spawn(async move {
        let res = child.wait().await;
        match res {
            Ok(st) => {
                wait_sink
                    .emit(format!("[alloy-agent] frpc exited: {st}"))
                    .await
            }
            Err(e) => {
                wait_sink
                    .emit(format!("[alloy-agent] frpc wait failed: {e}"))
                    .await
            }
        }
    });

    Ok(())
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

fn prepare_instance_command(
    process_id: &str,
    template_id: &str,
    params: &BTreeMap<String, String>,
    instance_dir: &Path,
    cwd: &Path,
    exec: &str,
    args: &[String],
    extra_rw_paths: &[PathBuf],
) -> anyhow::Result<(Command, sandbox::SandboxLaunch)> {
    let launch = sandbox::prepare_launch(
        process_id,
        template_id,
        params,
        instance_dir,
        cwd,
        exec,
        args,
        extra_rw_paths,
    )?;

    let mut cmd = Command::new(&launch.exec);
    cmd.current_dir(&launch.cwd)
        .args(&launch.args)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(unix)]
    {
        let limits = launch.limits.clone();
        let apply_host_limits = launch.should_apply_host_limits();
        unsafe {
            cmd.pre_exec(move || {
                set_parent_death_signal()?;
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                if apply_host_limits {
                    limits.apply_pre_exec()?;
                }
                Ok(())
            });
        }
    }

    Ok((cmd, launch))
}

fn docker_no_such_container(stderr: &str) -> bool {
    let msg = stderr.to_ascii_lowercase();
    msg.contains("no such container") || msg.contains("is not running")
}

fn first_non_empty_line(stdout: &[u8]) -> Option<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

async fn read_run_container_meta(process_id: &str) -> Option<RunContainerMeta> {
    let data_root = crate::minecraft::data_root();
    for dir in ["instances", "processes"] {
        let path = data_root.join(dir).join(process_id).join("run.json");
        let raw = match tokio::fs::read(&path).await {
            Ok(v) => v,
            Err(_) => continue,
        };
        if let Ok(meta) = serde_json::from_slice::<RunContainerMeta>(&raw) {
            return Some(meta);
        }
    }
    None
}

async fn docker_find_container_by_name(container_name: &str) -> Option<String> {
    let name_filter = format!("name=^/{container_name}$");
    let output = Command::new("docker")
        .env_remove("DOCKER_API_VERSION")
        .arg("ps")
        .arg("-aq")
        .arg("--no-trunc")
        .arg("--filter")
        .arg(name_filter)
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    first_non_empty_line(&output.stdout)
}

async fn docker_find_container_by_process(process_id: &str) -> Option<String> {
    let filter = format!("label=alloy.process_id={process_id}");
    let output = Command::new("docker")
        .env_remove("DOCKER_API_VERSION")
        .arg("ps")
        .arg("-q")
        .arg("--no-trunc")
        .arg("--filter")
        .arg(filter)
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    first_non_empty_line(&output.stdout)
}

async fn find_container_for_process(process_id: &str) -> Option<String> {
    if let Some(meta) = read_run_container_meta(process_id).await {
        if let Some(container_id) = meta.container_id.filter(|v| !v.trim().is_empty()) {
            return Some(container_id);
        }
        if let Some(container_name) = meta.container_name.filter(|v| !v.trim().is_empty())
            && let Some(container_id) = docker_find_container_by_name(&container_name).await
        {
            return Some(container_id);
        }
    }

    docker_find_container_by_process(process_id).await
}

async fn refresh_docker_container_metadata(process_id: &str, run: &mut RunInfo) {
    if run.container_name.is_none() {
        return;
    }
    if run.container_id.is_some() {
        return;
    }

    if let Some(container_id) = docker_find_container_by_process(process_id).await {
        run.container_id = Some(container_id);
    }
}

async fn docker_stop_container(container_id: &str, stop_timeout_secs: u64) -> anyhow::Result<()> {
    let timeout_secs = stop_timeout_secs.max(1).to_string();
    let output = Command::new("docker")
        .env_remove("DOCKER_API_VERSION")
        .arg("stop")
        .arg("--time")
        .arg(&timeout_secs)
        .arg(container_id)
        .output()
        .await
        .with_context(|| format!("run `docker stop` for container {container_id}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if docker_no_such_container(&stderr) {
        return Ok(());
    }

    anyhow::bail!(
        "docker stop failed for {container_id}: {}",
        stderr.trim().to_string()
    );
}

async fn docker_kill_container(container_id: &str) -> anyhow::Result<()> {
    let output = Command::new("docker")
        .env_remove("DOCKER_API_VERSION")
        .arg("kill")
        .arg(container_id)
        .output()
        .await
        .with_context(|| format!("run `docker kill` for container {container_id}"))?;

    if output.status.success() {
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);
    if docker_no_such_container(&stderr) {
        return Ok(());
    }

    anyhow::bail!(
        "docker kill failed for {container_id}: {}",
        stderr.trim().to_string()
    );
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

        let root_dir = if t.template_id == "minecraft:vanilla"
            || t.template_id == "minecraft:modrinth"
            || t.template_id == "minecraft:import"
            || t.template_id == "minecraft:curseforge"
            || t.template_id == "dst:vanilla"
            || t.template_id == "terraria:vanilla"
        {
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
                materialize_minecraft_server_jar(&instance_jar, &cached_jar).map_err(|e| {
                    crate::error_payload::anyhow(
                        "spawn_failed",
                        format!("failed to prepare server.jar: {e}"),
                        None,
                        Some("Ensure the instance directory is writable, then retry.".to_string()),
                    )
                })?;

                let exec = "java".to_string();
                let raw_args = vec![
                    format!("-Xmx{}M", mc.memory_mb),
                    "-jar".to_string(),
                    "server.jar".to_string(),
                    "nogui".to_string(),
                ];

                let (mut cmd, sandbox_launch) = prepare_instance_command(
                    &id.0,
                    &t.template_id,
                    &params,
                    &dir,
                    &dir,
                    &exec,
                    &raw_args,
                    &[],
                )?;

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
                    container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                    container_id: None,
                    exec: sandbox_launch.exec.clone(),
                    args: sandbox_launch.args.clone(),
                    cwd: sandbox_launch.cwd.display().to_string(),
                    params: redact_params(params.clone()),
                    env: collect_safe_env(),
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                    .await;
                for warning in sandbox_launch.warnings() {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                        .await;
                }

                sink.emit(format!(
                    "[alloy-agent] minecraft exec: {} {} (cwd {}) port={} version={}",
                    sandbox_launch.exec,
                    sandbox_launch.args.join(" "),
                    sandbox_launch.cwd.display(),
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

                if let Some(pid) = pid_u32
                    && let Some(warn) = sandbox_launch.attach_pid(pid)
                {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                        .await;
                }

                run.pid = pid_u32;
                run.pgid = pgid;
                refresh_docker_container_metadata(&id.0, &mut run).await;
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
                let frp_config = params
                    .get("frp_config")
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string());
                let frp_instance_dir = dir.clone();
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    let frp_config = frp_config.clone();
                    let frp_instance_dir = frp_instance_dir.clone();
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
                            if let (Some(cfg), Some(pgid)) = (frp_config.clone(), pgid) {
                                if let Err(e) = start_frpc_sidecar(
                                    probe_sink.clone(),
                                    frp_instance_dir.clone(),
                                    pgid,
                                    port,
                                    cfg,
                                )
                                .await
                                {
                                    probe_sink
                                        .emit(format!("[alloy-agent] frpc start failed: {e}"))
                                        .await;
                                }
                            }
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

                let process_pgid = pgid;
                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    #[cfg(unix)]
                    if let Some(pgid) = process_pgid {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let alive = unsafe { libc::kill(-pgid, 0) == 0 };
                        if alive {
                            unsafe {
                                libc::kill(-pgid, libc::SIGKILL);
                            }
                        }
                    }
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

            if t.template_id == "minecraft:modrinth" {
                ensure_min_free_space(&minecraft::data_root()).map_err(|e| {
                    crate::error_payload::anyhow(
                        "insufficient_disk",
                        e.to_string(),
                        None,
                        Some("Free up disk space under ALLOY_DATA_ROOT and try again.".to_string()),
                    )
                })?;

                let mc = minecraft_modrinth::validate_params(&params)?;

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
                let mc = minecraft_modrinth::ModrinthParams { port: mc_port, ..mc };
                params.insert("port".to_string(), mc_port.to_string());
                let restart = parse_restart_config(&params);

                let dir = minecraft::instance_dir(&id.0);
                minecraft::ensure_vanilla_instance_layout(
                    &dir,
                    &minecraft::VanillaParams {
                        version: "latest_release".to_string(),
                        memory_mb: mc.memory_mb,
                        port: mc.port,
                    },
                )?;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("resolving modpack...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] resolving modpack".to_string()).await;

                let installed = minecraft_modrinth::ensure_installed(&dir, &mc.mrpack)
                    .await
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "download_failed",
                            format!("failed to install modpack: {e}"),
                            None,
                            Some("Check network connectivity, or try again after clearing cache.".to_string()),
                        )
                    })?;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("checking minecraft version metadata...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] checking minecraft version metadata".to_string())
                    .await;

                let resolved = minecraft_download::resolve_server_jar(&installed.minecraft)
                    .await
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "download_failed",
                            format!("failed to resolve minecraft server metadata: {e}"),
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

                let instance_jar = dir.join("server.jar");
                if !instance_jar.exists() {
                    return Err(crate::error_payload::anyhow(
                        "install_failed",
                        "modpack install did not produce server.jar",
                        None,
                        Some("Clear the instance directory and try again.".to_string()),
                    ));
                }

                let exec = "java".to_string();
                let raw_args = vec![
                    format!("-Xmx{}M", mc.memory_mb),
                    "-jar".to_string(),
                    "server.jar".to_string(),
                    "nogui".to_string(),
                ];

                let (mut cmd, sandbox_launch) = prepare_instance_command(
                    &id.0,
                    &t.template_id,
                    &params,
                    &dir,
                    &dir,
                    &exec,
                    &raw_args,
                    &[],
                )?;

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
                    container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                    container_id: None,
                    exec: sandbox_launch.exec.clone(),
                    args: sandbox_launch.args.clone(),
                    cwd: sandbox_launch.cwd.display().to_string(),
                    params: redact_params(params.clone()),
                    env: collect_safe_env(),
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                    .await;
                for warning in sandbox_launch.warnings() {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                        .await;
                }

                sink.emit(format!(
                    "[alloy-agent] minecraft(modrinth) exec: {} {} (cwd {}) port={} minecraft={} loader={}:{}",
                    sandbox_launch.exec,
                    sandbox_launch.args.join(" "),
                    sandbox_launch.cwd.display(),
                    mc.port,
                    installed.minecraft,
                    installed.loader,
                    installed.loader_version,
                ))
                .await;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some(format!("spawning minecraft server (port {})...", mc.port)),
                )
                .await;

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

                if let Some(pid) = pid_u32
                    && let Some(warn) = sandbox_launch.attach_pid(pid)
                {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                        .await;
                }

                run.pid = pid_u32;
                run.pgid = pgid;
                refresh_docker_container_metadata(&id.0, &mut run).await;
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

                let probe_sink = sink.clone();
                let port = mc.port;
                let frp_config = params
                    .get("frp_config")
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string());
                let frp_instance_dir = dir.clone();
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    let frp_config = frp_config.clone();
                    let frp_instance_dir = frp_instance_dir.clone();
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
                            if let (Some(cfg), Some(pgid)) = (frp_config.clone(), pgid) {
                                if let Err(e) = start_frpc_sidecar(
                                    probe_sink.clone(),
                                    frp_instance_dir.clone(),
                                    pgid,
                                    port,
                                    cfg,
                                )
                                .await
                                {
                                    probe_sink
                                        .emit(format!("[alloy-agent] frpc start failed: {e}"))
                                        .await;
                                }
                            }
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

                let process_pgid = pgid;
                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    #[cfg(unix)]
                    if let Some(pgid) = process_pgid {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let alive = unsafe { libc::kill(-pgid, 0) == 0 };
                        if alive {
                            unsafe {
                                libc::kill(-pgid, libc::SIGKILL);
                            }
                        }
                    }
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

            if t.template_id == "minecraft:import" {
                ensure_min_free_space(&minecraft::data_root()).map_err(|e| {
                    crate::error_payload::anyhow(
                        "insufficient_disk",
                        e.to_string(),
                        None,
                        Some("Free up disk space under ALLOY_DATA_ROOT and try again.".to_string()),
                    )
                })?;

                let mc = minecraft_import::validate_params(&params)?;

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
                let mc = minecraft_import::ImportParams { port: mc_port, ..mc };
                params.insert("port".to_string(), mc_port.to_string());
                let restart = parse_restart_config(&params);

                let dir = minecraft::instance_dir(&id.0);

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("importing server pack...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] importing minecraft server pack".to_string())
                    .await;

                minecraft_import::ensure_imported(&dir, &mc.pack)
                    .await
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "install_failed",
                            format!("failed to import server pack: {e}"),
                            None,
                            Some("Ensure the pack is a server-ready zip or directory.".to_string()),
                        )
                    })?;

                minecraft::ensure_vanilla_instance_layout(
                    &dir,
                    &minecraft::VanillaParams {
                        version: "latest_release".to_string(),
                        memory_mb: mc.memory_mb,
                        port: mc.port,
                    },
                )?;

                let launch = minecraft_launch::resolve_launch_spec(&dir, mc.memory_mb).map_err(|e| {
                    crate::error_payload::anyhow(
                        "install_failed",
                        format!("failed to detect launch command: {e}"),
                        None,
                        Some(
                            "Expected server.jar (fabric/vanilla) or libraries/**/unix_args.txt (forge)."
                                .to_string(),
                        ),
                    )
                })?;

                let exec = launch.exec.clone();
                let raw_args = launch.args.clone();

                let (mut cmd, sandbox_launch) = prepare_instance_command(
                    &id.0,
                    &t.template_id,
                    &params,
                    &dir,
                    &dir,
                    &exec,
                    &raw_args,
                    &[],
                )?;

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
                    container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                    container_id: None,
                    exec: sandbox_launch.exec.clone(),
                    args: sandbox_launch.args.clone(),
                    cwd: sandbox_launch.cwd.display().to_string(),
                    params: redact_params(params.clone()),
                    env: collect_safe_env(),
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                    .await;
                for warning in sandbox_launch.warnings() {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                        .await;
                }

                sink.emit(format!(
                    "[alloy-agent] minecraft(import) exec: {} {} (cwd {}) port={} launch={}",
                    sandbox_launch.exec,
                    sandbox_launch.args.join(" "),
                    sandbox_launch.cwd.display(),
                    mc.port,
                    launch.kind
                ))
                .await;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some(format!("spawning minecraft server (port {})...", mc.port)),
                )
                .await;

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

                if let Some(pid) = pid_u32
                    && let Some(warn) = sandbox_launch.attach_pid(pid)
                {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                        .await;
                }

                run.pid = pid_u32;
                run.pgid = pgid;
                refresh_docker_container_metadata(&id.0, &mut run).await;
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

                let probe_sink = sink.clone();
                let port = mc.port;
                let frp_config = params
                    .get("frp_config")
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string());
                let frp_instance_dir = dir.clone();
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    let frp_config = frp_config.clone();
                    let frp_instance_dir = frp_instance_dir.clone();
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
                            if let (Some(cfg), Some(pgid)) = (frp_config.clone(), pgid) {
                                if let Err(e) = start_frpc_sidecar(
                                    probe_sink.clone(),
                                    frp_instance_dir.clone(),
                                    pgid,
                                    port,
                                    cfg,
                                )
                                .await
                                {
                                    probe_sink
                                        .emit(format!("[alloy-agent] frpc start failed: {e}"))
                                        .await;
                                }
                            }
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

                let process_pgid = pgid;
                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    #[cfg(unix)]
                    if let Some(pgid) = process_pgid {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let alive = unsafe { libc::kill(-pgid, 0) == 0 };
                        if alive {
                            unsafe {
                                libc::kill(-pgid, libc::SIGKILL);
                            }
                        }
                    }
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

            if t.template_id == "minecraft:curseforge" {
                ensure_min_free_space(&minecraft::data_root()).map_err(|e| {
                    crate::error_payload::anyhow(
                        "insufficient_disk",
                        e.to_string(),
                        None,
                        Some("Free up disk space under ALLOY_DATA_ROOT and try again.".to_string()),
                    )
                })?;

                let mc = minecraft_curseforge::validate_params(&params)?;

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
                let mc = minecraft_curseforge::CurseforgeParams { port: mc_port, ..mc };
                params.insert("port".to_string(), mc_port.to_string());
                let restart = parse_restart_config(&params);

                let dir = minecraft::instance_dir(&id.0);

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("resolving curseforge modpack...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] resolving curseforge modpack".to_string())
                    .await;

                let installed = minecraft_curseforge::ensure_installed(
                    &dir,
                    &mc.source,
                    &mc.api_key,
                )
                .await
                .map_err(|e| {
                    crate::error_payload::anyhow(
                        "download_failed",
                        format!("failed to install curseforge pack: {e}"),
                        None,
                        Some("Check the CurseForge API key and network connectivity.".to_string()),
                    )
                })?;

                minecraft::ensure_vanilla_instance_layout(
                    &dir,
                    &minecraft::VanillaParams {
                        version: "latest_release".to_string(),
                        memory_mb: mc.memory_mb,
                        port: mc.port,
                    },
                )?;

                let launch = minecraft_launch::resolve_launch_spec(&dir, mc.memory_mb).map_err(|e| {
                    crate::error_payload::anyhow(
                        "install_failed",
                        format!("failed to detect launch command: {e}"),
                        None,
                        Some(
                            "Expected server.jar (fabric/vanilla) or libraries/**/unix_args.txt (forge)."
                                .to_string(),
                        ),
                    )
                })?;

                let exec = launch.exec.clone();
                let raw_args = launch.args.clone();

                let (mut cmd, sandbox_launch) = prepare_instance_command(
                    &id.0,
                    &t.template_id,
                    &params,
                    &dir,
                    &dir,
                    &exec,
                    &raw_args,
                    &[],
                )?;

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
                    container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                    container_id: None,
                    exec: sandbox_launch.exec.clone(),
                    args: sandbox_launch.args.clone(),
                    cwd: sandbox_launch.cwd.display().to_string(),
                    params: redact_params(params.clone()),
                    env: collect_safe_env(),
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                    .await;
                for warning in sandbox_launch.warnings() {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                        .await;
                }

                sink.emit(format!(
                    "[alloy-agent] minecraft(curseforge) exec: {} {} (cwd {}) port={} launch={} cf_mod_id={} cf_file_id={} cf_server_pack_file_id={}",
                    sandbox_launch.exec,
                    sandbox_launch.args.join(" "),
                    sandbox_launch.cwd.display(),
                    mc.port,
                    launch.kind,
                    installed.mod_id,
                    installed.file_id,
                    installed.server_pack_file_id,
                ))
                .await;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some(format!("spawning minecraft server (port {})...", mc.port)),
                )
                .await;

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

                if let Some(pid) = pid_u32
                    && let Some(warn) = sandbox_launch.attach_pid(pid)
                {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                        .await;
                }

                run.pid = pid_u32;
                run.pgid = pgid;
                refresh_docker_container_metadata(&id.0, &mut run).await;
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

                let probe_sink = sink.clone();
                let port = mc.port;
                let frp_config = params
                    .get("frp_config")
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string());
                let frp_instance_dir = dir.clone();
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    let frp_config = frp_config.clone();
                    let frp_instance_dir = frp_instance_dir.clone();
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
                            if let (Some(cfg), Some(pgid)) = (frp_config.clone(), pgid) {
                                if let Err(e) = start_frpc_sidecar(
                                    probe_sink.clone(),
                                    frp_instance_dir.clone(),
                                    pgid,
                                    port,
                                    cfg,
                                )
                                .await
                                {
                                    probe_sink
                                        .emit(format!("[alloy-agent] frpc start failed: {e}"))
                                        .await;
                                }
                            }
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

                let process_pgid = pgid;
                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    #[cfg(unix)]
                    if let Some(pgid) = process_pgid {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let alive = unsafe { libc::kill(-pgid, 0) == 0 };
                        if alive {
                            unsafe {
                                libc::kill(-pgid, libc::SIGKILL);
                            }
                        }
                    }
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

            if t.template_id == "dst:vanilla" {
                ensure_min_free_space(&dst::data_root()).map_err(|e| {
                    crate::error_payload::anyhow(
                        "insufficient_disk",
                        e.to_string(),
                        None,
                        Some("Free up disk space under ALLOY_DATA_ROOT and try again.".to_string()),
                    )
                })?;

                let tr = dst::validate_vanilla_params(&params)?;

                let game_port = port_alloc::allocate_udp_port(tr.port).map_err(|e| {
                    let mut fields = BTreeMap::new();
                    fields.insert("port".to_string(), e.to_string());
                    crate::error_payload::anyhow(
                        "invalid_param",
                        "invalid port",
                        Some(fields),
                        Some("Pick another port (or use 0 to auto-assign).".to_string()),
                    )
                })?;
                let master_port = port_alloc::allocate_udp_port(tr.master_port).map_err(|e| {
                    let mut fields = BTreeMap::new();
                    fields.insert("master_port".to_string(), e.to_string());
                    crate::error_payload::anyhow(
                        "invalid_param",
                        "invalid master_port",
                        Some(fields),
                        Some("Pick another port (or use 0 to auto-assign).".to_string()),
                    )
                })?;
                let auth_port = port_alloc::allocate_udp_port(tr.auth_port).map_err(|e| {
                    let mut fields = BTreeMap::new();
                    fields.insert("auth_port".to_string(), e.to_string());
                    crate::error_payload::anyhow(
                        "invalid_param",
                        "invalid auth_port",
                        Some(fields),
                        Some("Pick another port (or use 0 to auto-assign).".to_string()),
                    )
                })?;

                // Best-effort: avoid obvious duplicates.
                if game_port == master_port || game_port == auth_port || master_port == auth_port {
                    return Err(crate::error_payload::anyhow(
                        "invalid_param",
                        "ports must be distinct",
                        None,
                        Some("Use different ports or set conflicting ones to 0 (auto).".to_string()),
                    ));
                }

                let tr = dst::VanillaParams {
                    port: game_port,
                    master_port,
                    auth_port,
                    ..tr
                };
                params.insert("port".to_string(), game_port.to_string());
                params.insert("master_port".to_string(), master_port.to_string());
                params.insert("auth_port".to_string(), auth_port.to_string());
                let restart = parse_restart_config(&params);

                let dir = dst::instance_dir(&id.0);
                dst::ensure_vanilla_instance_layout(&dir, &tr)?;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some("installing dst server files...".to_string()),
                )
                .await;
                sink.emit("[alloy-agent] installing dst server files".to_string())
                    .await;

                let server = dst_download::ensure_dst_server().await.map_err(|e| {
                    crate::error_payload::anyhow(
                        "download_failed",
                        format!("failed to install dst server: {e}"),
                        None,
                        Some(
                            "SteamCMD uses 32-bit binaries on amd64. Ensure 32-bit runtime libs are installed (libc6-i386, lib32gcc-s1, lib32stdc++6, lib32z1, lib32tinfo6). The error message includes SteamCMD output tail for debugging."
                                .to_string(),
                        ),
                    )
                })?;

                let persistent_root = dir.join("klei");

                let exec = server.bin.display().to_string();
                let raw_args = vec![
                    "-console".to_string(),
                    "-cluster".to_string(),
                    "Cluster_1".to_string(),
                    "-shard".to_string(),
                    "Master".to_string(),
                    "-persistent_storage_root".to_string(),
                    persistent_root.display().to_string(),
                    "-conf_dir".to_string(),
                    "DoNotStarveTogether".to_string(),
                ];
                let spawn_cwd = server
                    .bin
                    .parent()
                    .map(std::path::Path::to_path_buf)
                    .unwrap_or_else(|| server.server_root.clone());

                let (mut cmd, sandbox_launch) = prepare_instance_command(
                    &id.0,
                    &t.template_id,
                    &params,
                    &dir,
                    &spawn_cwd,
                    &exec,
                    &raw_args,
                    &[server.server_root.clone()],
                )?;

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
                    container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                    container_id: None,
                    exec: sandbox_launch.exec.clone(),
                    args: sandbox_launch.args.clone(),
                    cwd: sandbox_launch.cwd.display().to_string(),
                    params: redact_params(params.clone()),
                    env: collect_safe_env(),
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                    .await;
                for warning in sandbox_launch.warnings() {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                        .await;
                }

                sink.emit(format!(
                    "[alloy-agent] dst exec: {} {} (cwd {}) ports=udp:{} master={} auth={}",
                    sandbox_launch.exec,
                    sandbox_launch.args.join(" "),
                    sandbox_launch.cwd.display(),
                    tr.port,
                    tr.master_port,
                    tr.auth_port,
                ))
                .await;

                set_entry_message(
                    &self.inner,
                    &id.0,
                    Some(format!("spawning dst server (udp {})...", tr.port)),
                )
                .await;

                let mut child = cmd
                    .spawn()
                    .with_context(|| format!("spawn dst server (cwd {})", server.server_root.display()))
                    .map_err(|e| {
                        crate::error_payload::anyhow(
                            "spawn_failed",
                            e.to_string(),
                            None,
                            Some("Ensure the agent image includes required libraries for DST.".to_string()),
                        )
                    })?;
                let started = tokio::time::Instant::now();
                let pid_u32 = child.id();
                let pgid = pid_u32.map(|p| p as i32);

                if let Some(pid) = pid_u32
                    && let Some(warn) = sandbox_launch.attach_pid(pid)
                {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                        .await;
                }

                run.pid = pid_u32;
                run.pgid = pgid;
                refresh_docker_container_metadata(&id.0, &mut run).await;
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
                            message: Some("starting...".to_string()),
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

                // Best-effort: mark Running after a short delay if the process is still alive.
                let inner = self.inner.clone();
                let id_str = id.0.clone();
                tokio::spawn({
                    let inner = inner.clone();
                    async move {
                        tokio::time::sleep(Duration::from_millis(1500)).await;
                        let mut map = inner.lock().await;
                        let Some(e) = map.get_mut(&id_str) else { return };
                        if e.pid == pid_u32 && matches!(e.state, ProcessState::Starting) {
                            e.state = ProcessState::Running;
                            e.message = None;
                        }
                    }
                });

                let manager = self.clone();
                let inner = self.inner.clone();
                let id_str = id.0.clone();
                let process_pgid = pgid;
                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    #[cfg(unix)]
                    if let Some(pgid) = process_pgid {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let alive = unsafe { libc::kill(-pgid, 0) == 0 };
                        if alive {
                            unsafe {
                                libc::kill(-pgid, libc::SIGKILL);
                            }
                        }
                    }
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
                    message: Some("starting...".to_string()),
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

                let ld_library_path = format!(
                    "{}:{}:{}",
                    extracted.server_root.join("lib64").display(),
                    extracted.server_root.display(),
                    std::env::var("LD_LIBRARY_PATH").unwrap_or_default()
                );
                let exec = exec_path.display().to_string();
                let raw_args = vec!["-config".to_string(), config_path.display().to_string()];
                let (mut cmd, sandbox_launch) = prepare_instance_command(
                    &id.0,
                    &t.template_id,
                    &params,
                    &dir,
                    &extracted.server_root,
                    &exec,
                    &raw_args,
                    &[extracted.server_root.clone()],
                )?;
                cmd.env("TERM", "xterm")
                    .env("LD_LIBRARY_PATH", &ld_library_path);

                let started_at_unix_ms = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64;
                let mut env = collect_safe_env();
                env.insert("TERM".to_string(), "xterm".to_string());
                env.insert("LD_LIBRARY_PATH".to_string(), ld_library_path.clone());

                let mut run = RunInfo {
                    process_id: id.0.clone(),
                    template_id: t.template_id.clone(),
                    started_at_unix_ms,
                    agent_version: env!("CARGO_PKG_VERSION").to_string(),
                    pid: None,
                    pgid: None,
                    container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                    container_id: None,
                    exec: sandbox_launch.exec.clone(),
                    args: sandbox_launch.args.clone(),
                    cwd: sandbox_launch.cwd.display().to_string(),
                    params: redact_params(params.clone()),
                    env,
                };
                let _ = write_run_json(&dir, &run).await;

                sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                    .await;
                for warning in sandbox_launch.warnings() {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                        .await;
                }

                sink.emit(format!(
                    "[alloy-agent] terraria exec: {} {} (cwd {}) port={} version={}",
                    sandbox_launch.exec,
                    sandbox_launch.args.join(" "),
                    sandbox_launch.cwd.display(),
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

                if let Some(pid) = pid_u32
                    && let Some(warn) = sandbox_launch.attach_pid(pid)
                {
                    sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                        .await;
                }

                run.pid = pid_u32;
                run.pgid = pgid;
                refresh_docker_container_metadata(&id.0, &mut run).await;
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
                let frp_config = params
                    .get("frp_config")
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty())
                    .map(|v| v.to_string());
                let frp_instance_dir = dir.clone();
                tokio::spawn({
                    let inner = inner.clone();
                    let id_str = id_str.clone();
                    let frp_config = frp_config.clone();
                    let frp_instance_dir = frp_instance_dir.clone();
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
                            if let (Some(cfg), Some(pgid)) = (frp_config.clone(), pgid) {
                                if let Err(e) = start_frpc_sidecar(
                                    probe_sink.clone(),
                                    frp_instance_dir.clone(),
                                    pgid,
                                    port,
                                    cfg,
                                )
                                .await
                                {
                                    probe_sink
                                        .emit(format!("[alloy-agent] frpc start failed: {e}"))
                                        .await;
                                }
                            }
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

                let process_pgid = pgid;
                let wait_sink = sink.clone();
                let template_id = t.template_id.clone();
                let params_for_restart = params.clone();
                tokio::spawn(async move {
                    let res = child.wait().await;
                    #[cfg(unix)]
                    if let Some(pgid) = process_pgid {
                        unsafe {
                            libc::kill(-pgid, libc::SIGTERM);
                        }
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let alive = unsafe { libc::kill(-pgid, 0) == 0 };
                        if alive {
                            unsafe {
                                libc::kill(-pgid, libc::SIGKILL);
                            }
                        }
                    }
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

            let exec = t.command.clone();
            let raw_args = t.args.clone();
            let restart = parse_restart_config(&params);
            let cwd_path = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

            let (mut cmd, sandbox_launch) = prepare_instance_command(
                &id.0,
                &t.template_id,
                &params,
                &root_dir,
                &cwd_path,
                &exec,
                &raw_args,
                &[],
            )?;

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
                container_name: sandbox_launch.container_name().map(ToOwned::to_owned),
                container_id: None,
                exec: sandbox_launch.exec.clone(),
                args: sandbox_launch.args.clone(),
                cwd: sandbox_launch.cwd.display().to_string(),
                params: redact_params(params.clone()),
                env: collect_safe_env(),
            };
            let _ = write_run_json(&root_dir, &run).await;

            sink.emit(format!("[alloy-agent] sandbox: {}", sandbox_launch.summary()))
                .await;
            for warning in sandbox_launch.warnings() {
                sink.emit(format!("[alloy-agent] sandbox warning: {warning}"))
                    .await;
            }

            sink.emit(format!(
                "[alloy-agent] exec: {} {} (cwd {})",
                sandbox_launch.exec,
                sandbox_launch.args.join(" "),
                sandbox_launch.cwd.display()
            ))
            .await;

            let mut child = cmd
                .spawn()
                .with_context(|| {
                    format!(
                        "spawn process: exec={} (cwd {})",
                        sandbox_launch.exec,
                        sandbox_launch.cwd.display()
                    )
                })
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

            if let Some(pid) = pid_u32
                && let Some(warn) = sandbox_launch.attach_pid(pid)
            {
                sink.emit(format!("[alloy-agent] sandbox warning: {warn}"))
                    .await;
            }

            run.pid = pid_u32;
            run.pgid = pgid;
            refresh_docker_container_metadata(&id.0, &mut run).await;
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
                let msg = format_error_chain(&err);
                sink.emit(format!("[alloy-agent] start failed: {msg}"))
                    .await;

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
        let docker_container: Option<String>;

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

        docker_container = find_container_for_process(process_id).await;
        if let Some(container_id) = docker_container.as_deref() {
            emit(
                format!(
                    "[alloy-agent] stop: docker container detected ({})",
                    container_id.chars().take(12).collect::<String>()
                ),
                logs.clone(),
                log_tx.clone(),
            )
            .await;
        }

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
        if !graceful_sent {
            if let Some(container_id) = docker_container.as_deref() {
                match docker_stop_container(container_id, timeout.as_secs().max(1)).await {
                    Ok(()) => {
                        term_sent = true;
                        emit(
                            "[alloy-agent] stop: requested docker stop".to_string(),
                            logs.clone(),
                            log_tx.clone(),
                        )
                        .await;
                    }
                    Err(err) => {
                        emit(
                            format!("[alloy-agent] stop: docker stop failed: {err}"),
                            logs.clone(),
                            log_tx.clone(),
                        )
                        .await;
                    }
                }
            } else if let Some(pgid) = pgid {
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

            if !term_sent && now >= term_deadline {
                if let Some(container_id) = docker_container.as_deref() {
                    let remaining_secs = kill_deadline
                        .saturating_duration_since(now)
                        .as_secs()
                        .max(1);
                    match docker_stop_container(container_id, remaining_secs).await {
                        Ok(()) => {
                            term_sent = true;
                            emit(
                                "[alloy-agent] stop: requested docker stop (late)".to_string(),
                                logs.clone(),
                                log_tx.clone(),
                            )
                            .await;
                        }
                        Err(err) => {
                            emit(
                                format!("[alloy-agent] stop: docker stop failed (late): {err}"),
                                logs.clone(),
                                log_tx.clone(),
                            )
                            .await;
                        }
                    }
                } else if let Some(pgid) = pgid {
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
            }

            if now >= kill_deadline {
                // Escalate to hard-kill.
                let mut killed = false;
                let mut timeout_pgid: Option<i32> = None;
                {
                    let mut inner = self.inner.lock().await;
                    if let Some(e) = inner.get_mut(process_id) {
                        timeout_pgid = e.pgid;
                        if timeout_pgid.is_some() || docker_container.is_some() {
                            e.message = Some("killed after timeout".to_string());
                        }
                    }
                }

                if let Some(container_id) = docker_container.as_deref() {
                    match docker_kill_container(container_id).await {
                        Ok(()) => {
                            killed = true;
                        }
                        Err(err) => {
                            emit(
                                format!("[alloy-agent] stop: docker kill failed: {err}"),
                                logs.clone(),
                                log_tx.clone(),
                            )
                            .await;
                        }
                    }
                }

                if let Some(pgid) = timeout_pgid {
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                    killed = true;
                }

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
