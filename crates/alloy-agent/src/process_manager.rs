use std::{
    collections::{BTreeMap, HashMap, VecDeque},
    sync::Arc,
    time::Duration,
};

use alloy_process::{ProcessId, ProcessState, ProcessStatus, ProcessTemplateId};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{ChildStdin, Command},
    sync::Mutex,
};

use crate::templates;

const LOG_MAX_LINES: usize = 1000;

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
        let base = templates::find_template(template_id)
            .ok_or_else(|| anyhow::anyhow!("unknown template_id: {template_id}"))?;
        let t = templates::apply_params(base, &params)?;

        let id = ProcessId::new();
        let logs: Arc<Mutex<LogBuffer>> = Arc::new(Mutex::new(LogBuffer::default()));

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
                // Ensure stdin is dropped.
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

    pub async fn stop(&self, process_id: &str, timeout: Duration) -> anyhow::Result<ProcessStatus> {
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
            e.state = ProcessState::Stopping;
            e.message = Some("stopping".to_string());

            // Best-effort graceful command.
            if let Some(mut stdin) = e.stdin.take()
                && let Some(cmd) = e.graceful_stdin.take()
            {
                let _ = stdin.write_all(cmd.as_bytes()).await;
                let _ = stdin.flush().await;
            }

            if let Some(pgid) = e.pgid {
                #[cfg(unix)]
                unsafe {
                    // Send SIGTERM to the process group.
                    libc::kill(-pgid, libc::SIGTERM);
                }
            }
        }

        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            if let Some(status) = self.get_status(process_id).await
                && matches!(status.state, ProcessState::Exited | ProcessState::Failed)
            {
                return Ok(status);
            }

            if tokio::time::Instant::now() >= deadline {
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
