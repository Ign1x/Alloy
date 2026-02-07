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

use crate::minecraft_download::DownloadReport;

fn download_chunk_threshold(total_bytes: u64) -> u64 {
    if total_bytes >= 2 * 1024 * 1024 * 1024 {
        8 * 1024 * 1024
    } else if total_bytes >= 512 * 1024 * 1024 {
        4 * 1024 * 1024
    } else {
        1024 * 1024
    }
}

async fn download_zip_with_progress<F>(
    url: Url,
    expected_size: Option<u64>,
    mut on_progress: F,
) -> anyhow::Result<(Vec<u8>, DownloadReport)>
where
    F: FnMut(u64, u64, u64) + Send,
{
    let resp = http_client()
        .get(url)
        .send()
        .await
        .context("download terraria server zip")?
        .error_for_status()
        .context("download terraria server zip (status)")?;

    let total_bytes = expected_size.or(resp.content_length()).unwrap_or(0);
    let threshold = download_chunk_threshold(total_bytes.max(1));
    let mut stream = resp.bytes_stream();
    let mut out: Vec<u8> = Vec::new();
    let reserve_cap = total_bytes.min(512 * 1024 * 1024) as usize;
    if reserve_cap > 0 {
        out.reserve(reserve_cap);
    }

    let started_at = std::time::Instant::now();
    let mut last_emit_bytes = 0u64;
    let mut last_emit_at = started_at;
    let mut downloaded_bytes = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("read terraria server zip body chunk")?;
        downloaded_bytes = downloaded_bytes.saturating_add(chunk.len() as u64);
        out.extend_from_slice(&chunk);

        let now = std::time::Instant::now();
        let should_emit = downloaded_bytes.saturating_sub(last_emit_bytes) >= threshold
            || now.duration_since(last_emit_at) >= Duration::from_millis(300);
        if should_emit {
            let elapsed = now.duration_since(started_at).as_secs_f64();
            let speed = if elapsed > 0.0 {
                (downloaded_bytes as f64 / elapsed).round() as u64
            } else {
                0
            };
            let total = total_bytes.max(downloaded_bytes);
            on_progress(downloaded_bytes, total, speed);
            last_emit_bytes = downloaded_bytes;
            last_emit_at = now;
        }
    }

    let elapsed = started_at.elapsed().as_secs_f64();
    let speed = if elapsed > 0.0 {
        (downloaded_bytes as f64 / elapsed).round() as u64
    } else {
        0
    };
    let total = total_bytes.max(downloaded_bytes);
    on_progress(downloaded_bytes, total, speed);

    Ok((
        out,
        DownloadReport {
            downloaded_bytes,
            total_bytes: total,
            speed_bytes_per_sec: speed,
        },
    ))
}

pub struct ResolvedServerZip {
    pub version_id: String,
    pub zip_url: String,
}

pub struct ExtractedLinuxServer {
    pub server_root: PathBuf,
    pub bin_x86_64: PathBuf,
    pub launcher: Option<PathBuf>,
}

pub fn cache_dir() -> PathBuf {
    crate::terraria::data_root()
        .join("cache")
        .join("terraria")
        .join("vanilla")
}

fn mark_last_used(entry_dir: &std::path::Path) {
    let path = entry_dir.join(".last_used");
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    // Best-effort.
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
            .timeout(Duration::from_secs(15 * 60))
            .build()
            .expect("failed to build reqwest client")
    })
}

pub fn resolve_server_zip(version: &str) -> anyhow::Result<ResolvedServerZip> {
    // Official Re-Logic endpoint pattern:
    // https://terraria.org/api/download/pc-dedicated-server/terraria-server-<version>.zip
    // where <version> is like 1453 for Terraria 1.4.5.3.
    if !version.chars().all(|c| c.is_ascii_digit()) {
        anyhow::bail!("invalid version: {version}");
    }
    Ok(ResolvedServerZip {
        version_id: version.to_string(),
        zip_url: format!(
            "https://terraria.org/api/download/pc-dedicated-server/terraria-server-{version}.zip"
        ),
    })
}

pub async fn ensure_server_zip(resolved: &ResolvedServerZip) -> anyhow::Result<PathBuf> {
    ensure_server_zip_with_progress(resolved, None::<fn(u64, u64, u64)>).await
}

pub async fn ensure_server_zip_with_progress<F>(
    resolved: &ResolvedServerZip,
    mut on_progress: Option<F>,
) -> anyhow::Result<PathBuf>
where
    F: FnMut(u64, u64, u64) + Send,
{
    let zip_path = cache_dir()
        .join(&resolved.version_id)
        .join(format!("terraria-server-{}.zip", resolved.version_id));
    if zip_path.exists() {
        if let Some(dir) = zip_path.parent() {
            mark_last_used(dir);
        }
        let size = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
        if let Some(cb) = on_progress.as_mut() {
            cb(size, size, 0);
        }
        return Ok(zip_path);
    }

    let lock_key = format!("terraria:vanilla:{}", resolved.version_id);
    let lock = lock_for(&lock_key);
    let _guard = lock.lock().await;
    if zip_path.exists() {
        if let Some(dir) = zip_path.parent() {
            mark_last_used(dir);
        }
        let size = std::fs::metadata(&zip_path).map(|m| m.len()).unwrap_or(0);
        if let Some(cb) = on_progress.as_mut() {
            cb(size, size, 0);
        }
        return Ok(zip_path);
    }

    fs::create_dir_all(zip_path.parent().unwrap())?;

    let url = Url::parse(&resolved.zip_url)?;
    let mut last_err: Option<anyhow::Error> = None;
    let mut bytes: Option<Vec<u8>> = None;
    let mut last_report = DownloadReport {
        downloaded_bytes: 0,
        total_bytes: 0,
        speed_bytes_per_sec: 0,
    };
    for attempt in 1..=3_u32 {
        let res: anyhow::Result<Vec<u8>> = (async {
            let (bytes, report) = download_zip_with_progress(url.clone(), None, |downloaded, total, speed| {
                last_report = DownloadReport {
                    downloaded_bytes: downloaded,
                    total_bytes: total,
                    speed_bytes_per_sec: speed,
                };
                if let Some(cb) = on_progress.as_mut() {
                    cb(downloaded, total, speed);
                }
            })
            .await?;
            last_report = report;
            Ok(bytes)
        })
        .await;

        match res {
            Ok(b) => {
                bytes = Some(b);
                break;
            }
            Err(e) => {
                last_err = Some(e);
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_millis(
                        200_u64.saturating_mul(2_u64.pow(attempt - 1)),
                    ))
                    .await;
                }
            }
        }
    }

    let bytes =
        bytes.ok_or_else(|| last_err.unwrap_or_else(|| anyhow::anyhow!("download failed")))?;

    // No official first-party checksums are provided by Re-Logic for the ZIP.
    // We store the bytes as-is and rely on TLS + stable URL pattern.

    let tmp_path = zip_path.with_extension("tmp");
    let mut f = fs::File::create(&tmp_path)?;
    f.write_all(&bytes)?;
    f.sync_all()?;
    fs::rename(tmp_path, &zip_path)?;

    if let Some(cb) = on_progress.as_mut() {
        cb(
            last_report.downloaded_bytes,
            last_report.total_bytes.max(last_report.downloaded_bytes),
            last_report.speed_bytes_per_sec,
        );
    }

    if let Some(dir) = zip_path.parent() {
        mark_last_used(dir);
    }
    Ok(zip_path)
}

pub fn extract_linux_x64_to_cache(
    zip_path: &PathBuf,
    version_id: &str,
) -> anyhow::Result<ExtractedLinuxServer> {
    // IMPORTANT: do NOT extract only the native binary.
    // Terraria expects sidecar files (DLLs / native libs) to exist in its working dir.
    let server_root = cache_dir().join(version_id).join("linux-x64");
    let bin_x86_64 = server_root.join("TerrariaServer.bin.x86_64");
    let launcher = server_root.join("TerrariaServer");

    // Best-effort cache validation: ensure we didn't leave a half-extracted directory behind.
    // (Terraria's server package layout has changed over time; keep the check loose.)
    //
    // NOTE: Newer official dedicated-server ZIPs may not include a `Content/` directory at all.
    let looks_complete = bin_x86_64.exists()
        && (server_root.join("monoconfig").is_dir()
            || server_root.join("assemblies").is_dir()
            || server_root.join("lib64").is_dir())
        && (server_root.join("lib64").is_dir()
            || server_root.join("FNA.dll").is_file()
            || server_root.join("TerrariaServer.exe").is_file());
    if looks_complete {
        mark_last_used(&cache_dir().join(version_id));
        return Ok(ExtractedLinuxServer {
            server_root,
            bin_x86_64,
            launcher: if launcher.exists() {
                Some(launcher)
            } else {
                None
            },
        });
    }

    // If we have the binary but are missing key sidecars, wipe and re-extract.
    if bin_x86_64.exists() {
        let _ = fs::remove_dir_all(&server_root);
    }

    fs::create_dir_all(&server_root)?;

    let f = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(f).context("open terraria server zip")?;

    // Extract everything under */Linux/ into server_root.
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).context("read zip entry")?;
        let name = file.name();

        // Re-Logic server zips are typically "<version>/Linux/...", but may also be "Linux/...".
        // Find the "Linux" directory segment and extract everything underneath it.
        let rel = {
            let trimmed = name.trim_end_matches('/');
            if trimmed.is_empty() {
                continue;
            }
            let parts: Vec<&str> = trimmed.split('/').collect();
            let Some(idx) = parts.iter().position(|p| p.eq_ignore_ascii_case("Linux")) else {
                continue;
            };
            let rest = &parts[(idx + 1)..];
            if rest.is_empty() {
                continue;
            }
            rest.join("/")
        };

        let out_path = server_root.join(&rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let tmp_path = out_path.with_extension("tmp");
        let mut out = fs::File::create(&tmp_path).context("create extracted file")?;
        std::io::copy(&mut file, &mut out).context("extract file")?;
        out.sync_all().ok();
        fs::rename(&tmp_path, &out_path)?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if out_path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n == "TerrariaServer" || n == "TerrariaServer.bin.x86_64")
            {
                let mut perms = fs::metadata(&out_path)?.permissions();
                perms.set_mode(0o755);
                fs::set_permissions(&out_path, perms)?;
            }
        }
    }

    if !bin_x86_64.exists() {
        anyhow::bail!(
            "terraria server Linux binary not found after extract: {}",
            zip_path.display()
        );
    }

    mark_last_used(&cache_dir().join(version_id));
    Ok(ExtractedLinuxServer {
        server_root,
        bin_x86_64,
        launcher: if launcher.exists() {
            Some(launcher)
        } else {
            None
        },
    })
}
