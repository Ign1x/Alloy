use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    sync::Arc,
    time::Duration,
};

use alloy_process::{ProcessId, ProcessState, ProcessStatus, ProcessTemplateId};
use anyhow::Context;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::Mutex,
};

use crate::minecraft;
use crate::minecraft_download;
use crate::templates;

const LOG_MAX_LINES: usize = 1000;

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
    lines: VecDeque<(u64, String)>,
}

impl Default for LogBuffer {
    fn default() -> Self {
        Self {
            next_seq: 1,
            lines: VecDeque::new(),
        }
    }
}

impl LogBuffer {
    fn push_line(&mut self, line: String) {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        self.lines.push_back((seq, line));
        while self.lines.len() > LOG_MAX_LINES {
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

#[derive(Debug)]
struct ProcessEntry {
    template_id: ProcessTemplateId,
    state: ProcessState,
    pid: Option<u32>,
    exit_code: Option<i32>,
    message: Option<String>,
    stdin: Option<ChildStdin>,
    graceful_stdin: Option<String>,
    pgid: Option<i32>,
    logs: Arc<Mutex<LogBuffer>>,
}

#[derive(Clone, Debug, Default)]
pub struct ProcessManager {
    inner: Arc<Mutex<HashMap<String, ProcessEntry>>>,
}

impl ProcessManager {
    pub async fn start_from_template_with_process_id(
        &self,
        process_id: &str,
        template_id: &str,
        params: BTreeMap<String, String>,
    ) -> anyhow::Result<ProcessStatus> {
        if process_id.is_empty() {
            anyhow::bail!("process_id must be non-empty");
        }

        // Keep the ID stable (instance_id == process_id for MVP).
        // Allow restarting after exit/failure by replacing the old entry.
        {
            let mut inner = self.inner.lock().await;
            if let Some(existing) = inner.get(process_id)
                && matches!(existing.state, ProcessState::Running | ProcessState::Starting | ProcessState::Stopping)
            {
                anyhow::bail!("process_id already running: {process_id}");
            }
            // Remove any stale entry so we can re-use the same id.
            inner.remove(process_id);
        }

        let base = templates::find_template(template_id)
            .ok_or_else(|| anyhow::anyhow!("unknown template_id: {template_id}"))?;
        let t = templates::apply_params(base, &params)?;

        let id = ProcessId(process_id.to_string());
        let logs: Arc<Mutex<LogBuffer>> = Arc::new(Mutex::new(LogBuffer::default()));

        if t.template_id == "minecraft:vanilla" {
            let mc = minecraft::validate_vanilla_params(&params)?;
            let dir = minecraft::instance_dir(&id.0);
            minecraft::ensure_vanilla_instance_layout(&dir, &mc)?;

            let resolved = minecraft_download::resolve_server_jar(&mc.version).await?;
            let have_java = detect_java_major()?;
            if have_java != resolved.java_major {
                anyhow::bail!(
                    "java major mismatch: need {} (minecraft version {}), but runtime has {}",
                    resolved.java_major,
                    resolved.version_id,
                    have_java
                );
            }
            let cached_jar = minecraft_download::ensure_server_jar(&resolved).await?;

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
            cmd.current_dir(&dir)
                .arg(format!("-Xmx{}M", mc.memory_mb))
                .arg("-jar")
                .arg("server.jar")
                .arg("nogui")
                .stdin(std::process::Stdio::piped())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());

            #[cfg(unix)]
            {
                unsafe {
                    cmd.pre_exec(|| {
                        if libc::setsid() == -1 {
                            return Err(std::io::Error::last_os_error());
                        }
                        Ok(())
                    });
                }
            }

            let mut child = cmd.spawn()?;
            let pid_u32 = child.id();
            let pgid = pid_u32.map(|p| p as i32);

            let stdin = child.stdin.take();
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();

            if let Some(out) = stdout {
                let logs = logs.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(out).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        logs.lock().await.push_line(line);
                    }
                });
            }
            if let Some(err) = stderr {
                let logs = logs.clone();
                tokio::spawn(async move {
                    let mut lines = BufReader::new(err).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        logs.lock().await.push_line(line);
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
                        exit_code: None,
                        message: None,
                        stdin,
                        graceful_stdin: t.graceful_stdin.clone(),
                        pgid,
                        logs: logs.clone(),
                    },
                );
            }

            let inner = self.inner.clone();
            let id_str = id.0.clone();
            tokio::spawn(async move {
                let res = child.wait().await;
                let mut map = inner.lock().await;
                if let Some(e) = map.get_mut(&id_str) {
                    match res {
                        Ok(status) => {
                            e.state = ProcessState::Exited;
                            e.exit_code = status.code();
                            e.message = Some("exited".to_string());
                        }
                        Err(err) => {
                            e.state = ProcessState::Failed;
                            e.message = Some(format!("wait failed: {err}"));
                        }
                    }
                    e.stdin = None;
                }
            });

            return Ok(ProcessStatus {
                id: id.clone(),
                template_id: ProcessTemplateId(t.template_id),
                state: ProcessState::Running,
                pid: pid_u32,
                exit_code: None,
                message: None,
            });
        }

        let mut cmd = Command::new(&t.command);
        cmd.args(&t.args)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        #[cfg(unix)]
        {
            unsafe {
                cmd.pre_exec(|| {
                    // Start a new session so we can signal the whole process tree.
                    if libc::setsid() == -1 {
                        return Err(std::io::Error::last_os_error());
                    }
                    Ok(())
                });
            }
        }

        let mut child = cmd.spawn()?;
        let pid_u32 = child.id();
        let pgid = pid_u32.map(|p| p as i32);

        let stdin = child.stdin.take();
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();

        if let Some(out) = stdout {
            let logs = logs.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(out).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    logs.lock().await.push_line(line);
                }
            });
        }
        if let Some(err) = stderr {
            let logs = logs.clone();
            tokio::spawn(async move {
                let mut lines = BufReader::new(err).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    logs.lock().await.push_line(line);
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
                    exit_code: None,
                    message: None,
                    stdin,
                    graceful_stdin: t.graceful_stdin.clone(),
                    pgid,
                    logs: logs.clone(),
                },
            );
        }

        let inner = self.inner.clone();
        let id_str = id.0.clone();
        tokio::spawn(async move {
            let res = child.wait().await;
            let mut map = inner.lock().await;
            if let Some(e) = map.get_mut(&id_str) {
                match res {
                    Ok(status) => {
                        e.state = ProcessState::Exited;
                        e.exit_code = status.code();
                        e.message = Some("exited".to_string());
                    }
                    Err(err) => {
                        e.state = ProcessState::Failed;
                        e.message = Some(format!("wait failed: {err}"));
                    }
                }
                e.stdin = None;
            }
        });

        Ok(ProcessStatus {
            id: id.clone(),
            template_id: ProcessTemplateId(t.template_id),
            state: ProcessState::Running,
            pid: pid_u32,
            exit_code: None,
            message: None,
        })
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
        let pgid: Option<i32>;

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
                });
            }

            pgid = e.pgid;
            e.state = ProcessState::Stopping;
            e.message = Some("stopping".to_string());

            if let Some(mut stdin) = e.stdin.take()
                && let Some(cmd) = e.graceful_stdin.take()
            {
                let _ = stdin.write_all(cmd.as_bytes()).await;
                let _ = stdin.flush().await;
                // Intentionally drop stdin so the child sees EOF.
                graceful_sent = true;
            }
        }

        // If we didn't have a graceful command, send SIGTERM right away.
        if !graceful_sent && let Some(pgid) = pgid {
            #[cfg(unix)]
            unsafe {
                libc::kill(-pgid, libc::SIGTERM);
            }
            term_sent = true;
        }

        let start = tokio::time::Instant::now();
        let kill_deadline = start + timeout;
        // If we attempted graceful stdin, only send SIGTERM near the end.
        let term_deadline = if graceful_sent {
            kill_deadline
                .checked_sub(Duration::from_secs(5))
                .unwrap_or(start)
        } else {
            start
        };

        loop {
            if let Some(status) = self.get_status(process_id).await
                && matches!(status.state, ProcessState::Exited | ProcessState::Failed)
            {
                return Ok(status);
            }

            let now = tokio::time::Instant::now();

            if !term_sent
                && now >= term_deadline
                && let Some(pgid) = pgid
            {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-pgid, libc::SIGTERM);
                }
                term_sent = true;
            }

            if now >= kill_deadline {
                // Escalate to SIGKILL.
                let mut inner = self.inner.lock().await;
                if let Some(e) = inner.get_mut(process_id)
                    && let Some(pgid) = e.pgid
                {
                    #[cfg(unix)]
                    unsafe {
                        libc::kill(-pgid, libc::SIGKILL);
                    }
                    e.message = Some("killed after timeout".to_string());
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
