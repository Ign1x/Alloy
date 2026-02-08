#![allow(dead_code)]

use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
use reqwest::Url;
use tokio::sync::Mutex;

pub struct ResolvedFactorioPackage {
    pub version_id: String,
    pub tar_url: String,
}

pub struct ExtractedFactorioServer {
    pub server_root: PathBuf,
    pub binary: PathBuf,
}

pub fn cache_dir() -> PathBuf {
    crate::factorio::data_root()
        .join("cache")
        .join("factorio")
        .join("vanilla")
}

fn mark_last_used(entry_dir: &std::path::Path) {
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

pub fn resolve_server_package(version: &str) -> anyhow::Result<ResolvedFactorioPackage> {
    let version_id = version.trim();
    if version_id.is_empty() {
        anyhow::bail!("invalid version");
    }

    // Official headless package endpoint.
    // stable / experimental are accepted aliases by factorio.com.
    Ok(ResolvedFactorioPackage {
        version_id: version_id.to_string(),
        tar_url: format!(
            "https://factorio.com/get-download/{}/headless/linux64",
            version_id
        ),
    })
}

pub async fn ensure_server_package(resolved: &ResolvedFactorioPackage) -> anyhow::Result<PathBuf> {
    let tar_path = cache_dir().join(&resolved.version_id).join(format!(
        "factorio_headless_x64_{}.tar.xz",
        resolved.version_id
    ));
    if tar_path.exists() {
        if let Some(dir) = tar_path.parent() {
            mark_last_used(dir);
        }
        return Ok(tar_path);
    }

    let lock_key = format!("factorio:vanilla:{}", resolved.version_id);
    let lock = lock_for(&lock_key);
    let _guard = lock.lock().await;
    if tar_path.exists() {
        if let Some(dir) = tar_path.parent() {
            mark_last_used(dir);
        }
        return Ok(tar_path);
    }

    fs::create_dir_all(tar_path.parent().unwrap())?;

    let url = Url::parse(&resolved.tar_url)?;
    let mut last_err: Option<anyhow::Error> = None;
    let mut bytes: Option<Vec<u8>> = None;

    for attempt in 1..=3_u32 {
        let res: anyhow::Result<Vec<u8>> = (async {
            let resp = http_client()
                .get(url.clone())
                .send()
                .await
                .context("download factorio headless package")?
                .error_for_status()
                .context("download factorio headless package (status)")?;

            let mut stream = resp.bytes_stream();
            let mut out = Vec::<u8>::new();
            while let Some(chunk) = stream.next().await {
                let chunk = chunk.context("read factorio package chunk")?;
                out.extend_from_slice(&chunk);
                if out.len() > 4 * 1024 * 1024 * 1024_usize {
                    anyhow::bail!("factorio package too large");
                }
            }
            Ok(out)
        })
        .await;

        match res {
            Ok(v) => {
                bytes = Some(v);
                break;
            }
            Err(e) => {
                last_err = Some(e);
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_millis(
                        300_u64.saturating_mul(2_u64.pow(attempt - 1)),
                    ))
                    .await;
                }
            }
        }
    }

    let bytes =
        bytes.ok_or_else(|| last_err.unwrap_or_else(|| anyhow::anyhow!("download failed")))?;

    let tmp_path = tar_path.with_extension("tmp");
    let mut f = fs::File::create(&tmp_path)?;
    f.write_all(&bytes)?;
    f.sync_all()?;
    fs::rename(tmp_path, &tar_path)?;

    if let Some(dir) = tar_path.parent() {
        mark_last_used(dir);
    }
    Ok(tar_path)
}

pub fn extract_server_to_cache(
    tar_path: &PathBuf,
    version_id: &str,
) -> anyhow::Result<ExtractedFactorioServer> {
    let server_root = cache_dir().join(version_id).join("factorio");
    let binary = server_root.join("bin").join("x64").join("factorio");

    if binary.exists() {
        mark_last_used(&cache_dir().join(version_id));
        return Ok(ExtractedFactorioServer {
            server_root,
            binary,
        });
    }

    if server_root.exists() {
        let _ = fs::remove_dir_all(&server_root);
    }
    fs::create_dir_all(server_root.parent().unwrap_or(&server_root))?;

    // Use system tar to avoid extra rust deps; .tar.xz is supported by GNU tar.
    let extract_root = cache_dir().join(version_id);
    fs::create_dir_all(&extract_root)?;
    let status = std::process::Command::new("tar")
        .arg("-xJf")
        .arg(tar_path)
        .arg("-C")
        .arg(&extract_root)
        .status()
        .context("extract factorio package with tar")?;
    if !status.success() {
        anyhow::bail!("extract factorio package failed (tar exit {})", status);
    }

    if !binary.exists() {
        anyhow::bail!(
            "factorio binary not found after extract: {}",
            tar_path.display()
        );
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&binary)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&binary, perms)?;
    }

    mark_last_used(&cache_dir().join(version_id));
    Ok(ExtractedFactorioServer {
        server_root,
        binary,
    })
}
