#![allow(dead_code, clippy::manual_find)]

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use anyhow::Context;
use tokio::sync::Mutex;

pub const PALWORLD_APP_ID: &str = "2394010";

pub struct InstalledPalworldServer {
    pub server_root: PathBuf,
    pub launcher: PathBuf,
}

fn cache_dir() -> PathBuf {
    crate::palworld::data_root()
        .join("cache")
        .join("palworld")
        .join("vanilla")
}

fn steamcmd_dir() -> PathBuf {
    crate::minecraft::data_root().join("cache").join("steamcmd")
}

fn mark_last_used(entry_dir: &Path) {
    let path = entry_dir.join(".last_used");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let _ = std::fs::write(path, format!("{now_ms}\n"));
}

fn install_locks() -> &'static std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn lock_for(key: &str) -> Arc<Mutex<()>> {
    let mut map = install_locks().lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

async fn ensure_steamcmd() -> anyhow::Result<PathBuf> {
    // Re-use DST steamcmd bootstrap to avoid duplicate logic.
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
    let url = "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz";

    let client = reqwest::Client::builder()
        .user_agent("alloy-agent")
        .timeout(std::time::Duration::from_secs(30 * 60))
        .build()
        .context("build reqwest client")?;

    let bytes = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("download {url}"))?
        .error_for_status()
        .with_context(|| format!("download {url} (status)"))?
        .bytes()
        .await
        .context("read steamcmd download body")?;

    tokio::fs::write(&tgz, &bytes).await?;

    let status = tokio::process::Command::new("tar")
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

fn find_launcher(install_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        install_dir.join("PalServer.sh"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("PalServer")
            .join("PalServer.sh"),
    ];
    for p in candidates {
        if p.is_file() {
            return Some(p);
        }
    }
    None
}

pub async fn ensure_palworld_server() -> anyhow::Result<InstalledPalworldServer> {
    let install_dir = cache_dir().join("latest");
    if let Some(launcher) = find_launcher(&install_dir) {
        mark_last_used(&cache_dir());
        return Ok(InstalledPalworldServer {
            server_root: launcher
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| install_dir.clone()),
            launcher,
        });
    }

    let lock = lock_for("palworld:vanilla:latest");
    let _guard = lock.lock().await;

    if let Some(launcher) = find_launcher(&install_dir) {
        mark_last_used(&cache_dir());
        return Ok(InstalledPalworldServer {
            server_root: launcher
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| install_dir.clone()),
            launcher,
        });
    }

    let steamcmd_sh = ensure_steamcmd().await?;
    tokio::fs::create_dir_all(&install_dir).await?;

    let mut cmd = tokio::process::Command::new(&steamcmd_sh);
    cmd.current_dir(steamcmd_dir())
        .arg("+force_install_dir")
        .arg(&install_dir)
        .arg("+login")
        .arg("anonymous")
        .arg("+app_update")
        .arg(PALWORLD_APP_ID)
        .arg("validate")
        .arg("+quit")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let out = cmd.output().await.context("run steamcmd for palworld")?;
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

    let launcher = find_launcher(&install_dir).with_context(|| {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        format!(
            "palworld launcher not found after install.\nsteamcmd stdout (tail):\n{stdout}\nsteamcmd stderr (tail):\n{stderr}"
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&launcher)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&launcher, perms)?;
    }

    mark_last_used(&cache_dir());
    Ok(InstalledPalworldServer {
        server_root: launcher
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(install_dir),
        launcher,
    })
}
