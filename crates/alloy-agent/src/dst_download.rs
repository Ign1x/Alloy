#![allow(dead_code)]

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use tokio::sync::Mutex;

use crate::minecraft;

pub struct InstalledDstServer {
    pub server_root: PathBuf,
    pub bin: PathBuf,
}

fn cache_dir() -> PathBuf {
    minecraft::data_root()
        .join("cache")
        .join("dst")
        .join("vanilla")
}

fn find_dst_server_bin(install_dir: &Path) -> Option<PathBuf> {
    // Prefer wrapper scripts in the server root when present since they tend to
    // set up environment variables required by the dedicated server.
    let candidates = [
        install_dir.join("dontstarve_dedicated_server_nullrenderer"),
        install_dir
            .join("bin64")
            .join("dontstarve_dedicated_server_nullrenderer"),
        install_dir
            .join("bin")
            .join("dontstarve_dedicated_server_nullrenderer"),
        install_dir
            .join("bin64")
            .join("dontstarve_dedicated_server_nullrenderer_x64"),
        install_dir
            .join("bin")
            .join("dontstarve_dedicated_server_nullrenderer_x64"),
    ];
    for p in candidates {
        if p.is_file() {
            return Some(p);
        }
    }

    // Last-resort fallback: upstream has changed the layout before (sometimes
    // nesting the game under steamapps/common). If the expected paths are
    // missing, search a few levels deep for anything that looks like the
    // dedicated server entrypoint.
    fn walk(cur: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth == 0 {
            return;
        }
        let rd = match std::fs::read_dir(cur) {
            Ok(v) => v,
            Err(_) => return,
        };
        for e in rd.flatten() {
            let p = e.path();
            let ty = match e.file_type() {
                Ok(v) => v,
                Err(_) => continue,
            };
            if ty.is_dir() {
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    // Avoid scanning very large trees.
                    if matches!(name, "data" | "mods" | "ugc_mods") {
                        continue;
                    }
                }
                walk(&p, depth - 1, out);
                continue;
            }
            if !ty.is_file() {
                continue;
            }
            let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
                continue;
            };
            if name.starts_with("dontstarve_dedicated_server_nullrenderer") {
                out.push(p);
            }
        }
    }

    let mut hits = Vec::<PathBuf>::new();
    let alt = install_dir.join("steamapps").join("common");
    if alt.is_dir() {
        walk(&alt, 4, &mut hits);
    } else {
        walk(install_dir, 4, &mut hits);
    }

    hits.sort();
    hits.dedup();
    hits.into_iter().next()
}

fn steamcmd_dir() -> PathBuf {
    minecraft::data_root().join("cache").join("steamcmd")
}

fn mark_last_used(entry_dir: &Path) {
    let path = entry_dir.join(".last_used");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let _ = std::fs::write(path, format!("{now_ms}\n"));
}

fn download_locks() -> &'static std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn lock_for(key: &str) -> Arc<Mutex<()>> {
    let mut map = download_locks().lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("alloy-agent")
            .timeout(Duration::from_secs(30 * 60))
            .build()
            .expect("failed to build reqwest client")
    })
}

async fn download_to_path(url: &str, path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let resp = http_client()
        .get(url)
        .send()
        .await
        .with_context(|| format!("download {url}"))?
        .error_for_status()
        .with_context(|| format!("download {url} (status)"))?;

    let tmp = path.with_extension("tmp");
    let mut f = tokio::fs::File::create(&tmp).await?;
    let mut total: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        total = total.saturating_add(chunk.len() as u64);
        if total > 2 * 1024 * 1024 * 1024_u64 {
            let _ = tokio::fs::remove_file(&tmp).await;
            anyhow::bail!("download too large");
        }
        tokio::io::AsyncWriteExt::write_all(&mut f, &chunk).await?;
    }
    tokio::io::AsyncWriteExt::flush(&mut f).await.ok();
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

async fn ensure_steamcmd() -> anyhow::Result<PathBuf> {
    let dir = steamcmd_dir();
    let sh = dir.join("steamcmd.sh");
    if sh.exists() {
        return Ok(sh);
    }

    let lock = lock_for("steamcmd");
    let _guard = lock.lock().await;
    if sh.exists() {
        return Ok(sh);
    }

    tokio::fs::create_dir_all(&dir).await?;
    let tgz = dir.join("steamcmd_linux.tar.gz");
    download_to_path(
        "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz",
        &tgz,
    )
    .await
    .context("download steamcmd tar.gz")?;

    // Extract using system tar to keep dependencies minimal.
    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&tgz)
        .arg("-C")
        .arg(&dir)
        .status()
        .await
        .context("extract steamcmd (tar)")?;
    if !status.success() {
        anyhow::bail!("steamcmd extract failed (tar exit {})", status);
    }

    if !sh.exists() {
        anyhow::bail!("steamcmd.sh not found after extract");
    }
    Ok(sh)
}

struct TailBuffer {
    buf: Vec<u8>,
    cap: usize,
    start: usize,
    len: usize,
}

impl TailBuffer {
    fn new(cap: usize) -> Self {
        Self {
            buf: vec![0; cap.max(1)],
            cap: cap.max(1),
            start: 0,
            len: 0,
        }
    }

    fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }

        if data.len() >= self.cap {
            self.buf.copy_from_slice(&data[data.len() - self.cap..]);
            self.start = 0;
            self.len = self.cap;
            return;
        }

        let total = self.len.saturating_add(data.len());
        if total > self.cap {
            let drop = total - self.cap;
            self.start = (self.start + drop) % self.cap;
            self.len = self.cap;
        } else {
            self.len = total;
        }

        let write_pos = (self.start + self.len - data.len()) % self.cap;
        let first = (self.cap - write_pos).min(data.len());
        self.buf[write_pos..write_pos + first].copy_from_slice(&data[..first]);
        if first < data.len() {
            self.buf[..data.len() - first].copy_from_slice(&data[first..]);
        }
    }

    fn to_vec(&self) -> Vec<u8> {
        if self.len == 0 {
            return Vec::new();
        }

        if self.start + self.len <= self.cap {
            return self.buf[self.start..self.start + self.len].to_vec();
        }

        let first = self.cap - self.start;
        let second = self.len - first;
        let mut out = Vec::with_capacity(self.len);
        out.extend_from_slice(&self.buf[self.start..]);
        out.extend_from_slice(&self.buf[..second]);
        out
    }
}

async fn read_tail<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    limit_bytes: usize,
) -> anyhow::Result<Vec<u8>> {
    let mut tail = TailBuffer::new(limit_bytes);
    let mut buf = [0u8; 8192];
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        tail.push(&buf[..n]);
    }
    Ok(tail.to_vec())
}

pub async fn ensure_dst_server() -> anyhow::Result<InstalledDstServer> {
    // SteamCMD + DST dedicated server is only available as x86 Linux binaries.
    #[cfg(not(target_arch = "x86_64"))]
    {
        anyhow::bail!("dst:vanilla is currently supported on amd64 nodes only");
    }

    let install_dir = cache_dir().join("latest");
    if let Some(bin) = find_dst_server_bin(&install_dir) {
        mark_last_used(&cache_dir());
        return Ok(InstalledDstServer {
            server_root: install_dir,
            bin,
        });
    }

    let lock = lock_for("dst:vanilla:latest");
    let _guard = lock.lock().await;

    // Check again after lock.
    if let Some(bin) = find_dst_server_bin(&install_dir) {
        mark_last_used(&cache_dir());
        return Ok(InstalledDstServer {
            server_root: install_dir,
            bin,
        });
    }

    let steamcmd_sh = ensure_steamcmd().await?;
    tokio::fs::create_dir_all(&install_dir).await?;

    let mut cmd = Command::new(&steamcmd_sh);
    cmd.current_dir(steamcmd_dir())
        .arg("+force_install_dir")
        .arg(&install_dir)
        .arg("+login")
        .arg("anonymous")
        .arg("+app_update")
        .arg("343050")
        .arg("validate")
        .arg("+quit")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().context("spawn steamcmd")?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    const TAIL_BYTES: usize = 64 * 1024;
    let stdout_task = stdout.map(|s| tokio::spawn(read_tail(s, TAIL_BYTES)));
    let stderr_task = stderr.map(|s| tokio::spawn(read_tail(s, TAIL_BYTES)));

    let status = child.wait().await.context("wait steamcmd")?;
    let stdout_tail = match stdout_task {
        Some(h) => h.await.context("join steamcmd stdout")??,
        None => Vec::new(),
    };
    let stderr_tail = match stderr_task {
        Some(h) => h.await.context("join steamcmd stderr")??,
        None => Vec::new(),
    };

    if !status.success() {
        let stdout = String::from_utf8_lossy(&stdout_tail);
        let stderr = String::from_utf8_lossy(&stderr_tail);
        anyhow::bail!(
            "steamcmd failed (exit {}):\nstdout:\n{}\nstderr:\n{}",
            status,
            stdout,
            stderr
        );
    }

    let bin = find_dst_server_bin(&install_dir).with_context(|| {
        let stdout = String::from_utf8_lossy(&stdout_tail);
        let stderr = String::from_utf8_lossy(&stderr_tail);
        format!(
            "dst server binary not found after install.\nsteamcmd stdout (tail):\n{stdout}\nsteamcmd stderr (tail):\n{stderr}",
        )
    })?;

    mark_last_used(&cache_dir());
    Ok(InstalledDstServer {
        server_root: install_dir,
        bin,
    })
}

#[cfg(test)]
mod tests {
    use super::TailBuffer;

    #[test]
    fn tail_buffer_keeps_last_bytes() {
        let mut t = TailBuffer::new(5);
        t.push(b"hello");
        assert_eq!(t.to_vec(), b"hello");

        t.push(b"world");
        assert_eq!(t.to_vec(), b"world");

        t.push(b"!!!");
        assert_eq!(t.to_vec(), b"ld!!!");

        t.push(b"1234567");
        assert_eq!(t.to_vec(), b"34567");
    }
}
