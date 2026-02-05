#![allow(dead_code)]

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
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

pub async fn ensure_dst_server() -> anyhow::Result<InstalledDstServer> {
    // SteamCMD + DST dedicated server is only available as x86 Linux binaries.
    #[cfg(not(target_arch = "x86_64"))]
    {
        anyhow::bail!("dst:vanilla is currently supported on amd64 nodes only");
    }

    let install_dir = cache_dir().join("latest");
    let bin64 = install_dir
        .join("bin64")
        .join("dontstarve_dedicated_server_nullrenderer");
    let bin_root = install_dir.join("dontstarve_dedicated_server_nullrenderer");

    let bin = if bin64.exists() {
        bin64.clone()
    } else if bin_root.exists() {
        bin_root.clone()
    } else {
        PathBuf::new()
    };

    if !bin.as_os_str().is_empty() {
        mark_last_used(&cache_dir());
        return Ok(InstalledDstServer {
            server_root: install_dir,
            bin,
        });
    }

    let lock = lock_for("dst:vanilla:latest");
    let _guard = lock.lock().await;

    // Check again after lock.
    let bin64 = install_dir
        .join("bin64")
        .join("dontstarve_dedicated_server_nullrenderer");
    let bin_root = install_dir.join("dontstarve_dedicated_server_nullrenderer");
    let bin = if bin64.exists() {
        bin64.clone()
    } else if bin_root.exists() {
        bin_root.clone()
    } else {
        PathBuf::new()
    };
    if !bin.as_os_str().is_empty() {
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

    let out = cmd.output().await.context("run steamcmd")?;
    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        anyhow::bail!(
            "steamcmd failed (exit {}):\nstdout:\n{}\nstderr:\n{}",
            out.status,
            stdout,
            stderr
        );
    }

    let bin = if bin64.exists() {
        bin64
    } else if bin_root.exists() {
        bin_root
    } else {
        anyhow::bail!("dst server binary not found after install");
    };

    mark_last_used(&cache_dir());
    Ok(InstalledDstServer {
        server_root: install_dir,
        bin,
    })
}
