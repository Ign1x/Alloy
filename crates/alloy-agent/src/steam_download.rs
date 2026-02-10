#![allow(dead_code)]

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, OnceLock},
};

use anyhow::Context;
use tokio::sync::Mutex;

pub struct InstalledSteamServer {
    pub server_root: PathBuf,
    pub launcher: PathBuf,
}

fn locks() -> &'static std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn lock_for(key: &str) -> Arc<Mutex<()>> {
    let mut map = locks().lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

pub fn steamcmd_dir() -> PathBuf {
    crate::minecraft::data_root().join("cache").join("steamcmd")
}

pub fn mark_last_used(entry_dir: &Path) {
    let path = entry_dir.join(".last_used");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let _ = std::fs::write(path, format!("{now_ms}\n"));
}

pub async fn ensure_steamcmd() -> anyhow::Result<PathBuf> {
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

fn walk_find(
    cur: &Path,
    depth: usize,
    wanted: &[&str],
    out: &mut Vec<PathBuf>,
    skip_dirs: &[&str],
) {
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
            if let Some(name) = p.file_name().and_then(|s| s.to_str())
                && skip_dirs.contains(&name)
            {
                continue;
            }
            walk_find(&p, depth - 1, wanted, out, skip_dirs);
            continue;
        }
        if !ty.is_file() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if wanted.iter().any(|w| {
            name.eq_ignore_ascii_case(w) || name.eq_ignore_ascii_case(&format!("{w}.x86_64"))
        }) {
            out.push(p);
        }
    }
}

pub fn find_launcher_with_fallback(
    install_dir: &Path,
    candidates: &[PathBuf],
    wanted_names: &[&str],
) -> Option<PathBuf> {
    for p in candidates {
        if p.is_file() {
            return Some(p.clone());
        }
    }

    let mut hits = Vec::<PathBuf>::new();
    let alt = install_dir.join("steamapps").join("common");
    if alt.is_dir() {
        walk_find(
            &alt,
            5,
            wanted_names,
            &mut hits,
            &["steamapps", "workshop", "LinuxServer_Data"],
        );
    } else {
        walk_find(
            install_dir,
            5,
            wanted_names,
            &mut hits,
            &["steamapps", "workshop", "LinuxServer_Data"],
        );
    }

    hits.sort();
    hits.dedup();
    hits.into_iter().next()
}

pub fn ensure_runtime_artifacts(server_root: &Path, launcher: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(launcher)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(launcher, perms)?;
    }

    let Some(launcher_dir) = launcher.parent() else {
        return Ok(());
    };
    let dst = launcher_dir.join("steamclient.so");
    if !dst.is_file() {
        let candidates = [
            server_root.join("linux64").join("steamclient.so"),
            server_root.join("linux32").join("steamclient.so"),
            server_root.join("steamclient.so"),
        ];
        if let Some(src) = candidates.into_iter().find(|p| p.is_file()) {
            let _ = std::fs::copy(&src, &dst);
        }
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&dst) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&dst, perms);
        }
    }

    Ok(())
}

pub async fn ensure_steam_app_latest<F>(
    app_id: &str,
    cache_dir: &Path,
    lock_key: &str,
    find_launcher: F,
) -> anyhow::Result<InstalledSteamServer>
where
    F: Fn(&Path) -> Option<PathBuf>,
{
    let install_dir = cache_dir.join("latest");
    if let Some(launcher) = find_launcher(&install_dir) {
        ensure_runtime_artifacts(&install_dir, &launcher)?;
        mark_last_used(cache_dir);
        return Ok(InstalledSteamServer {
            server_root: launcher
                .parent()
                .map(|p| p.to_path_buf())
                .unwrap_or_else(|| install_dir.clone()),
            launcher,
        });
    }

    let lock = lock_for(lock_key);
    let _guard = lock.lock().await;

    if let Some(launcher) = find_launcher(&install_dir) {
        ensure_runtime_artifacts(&install_dir, &launcher)?;
        mark_last_used(cache_dir);
        return Ok(InstalledSteamServer {
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
        .arg(app_id)
        .arg("validate")
        .arg("+quit")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let out = cmd
        .output()
        .await
        .with_context(|| format!("run steamcmd for app {app_id}"))?;
    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        anyhow::bail!(
            "steamcmd failed for app {} (exit {}):\nstdout:\n{}\nstderr:\n{}",
            app_id,
            out.status,
            stdout,
            stderr
        );
    }

    let launcher = find_launcher(&install_dir).with_context(|| {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        format!(
            "launcher not found after install for app {app_id}.\nsteamcmd stdout (tail):\n{stdout}\nsteamcmd stderr (tail):\n{stderr}"
        )
    })?;

    ensure_runtime_artifacts(&install_dir, &launcher)?;
    mark_last_used(cache_dir);
    Ok(InstalledSteamServer {
        server_root: launcher
            .parent()
            .map(|p| p.to_path_buf())
            .unwrap_or(install_dir),
        launcher,
    })
}
