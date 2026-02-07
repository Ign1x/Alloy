#![allow(dead_code)]

use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::Path,
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
use reqwest::Url;
use sha1::Digest;
use tokio::sync::Mutex;

#[derive(Debug, Clone)]
pub struct DownloadReport {
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
}

fn download_chunk_threshold(total_bytes: u64) -> u64 {
    if total_bytes >= 2 * 1024 * 1024 * 1024 {
        8 * 1024 * 1024
    } else if total_bytes >= 512 * 1024 * 1024 {
        4 * 1024 * 1024
    } else {
        1024 * 1024
    }
}

pub async fn download_bytes_with_progress<F>(
    url: Url,
    expected_size: Option<u64>,
    mut on_progress: F,
) -> anyhow::Result<(Vec<u8>, DownloadReport)>
where
    F: FnMut(u64, u64, u64) + Send,
{
    let resp = http_client()
        .get(url.clone())
        .send()
        .await
        .context("download server.jar")?
        .error_for_status()
        .context("download server.jar (status)")?;

    let total_bytes = expected_size.or(resp.content_length()).unwrap_or(0);
    let threshold = download_chunk_threshold(total_bytes.max(1));
    let mut stream = resp.bytes_stream();
    let mut out: Vec<u8> = Vec::new();
    let reserve_cap = total_bytes.min(256 * 1024 * 1024) as usize;
    if reserve_cap > 0 {
        out.reserve(reserve_cap);
    }

    let started_at = std::time::Instant::now();
    let mut last_emit_bytes = 0u64;
    let mut last_emit_at = started_at;
    let mut downloaded_bytes = 0u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("read server.jar body chunk")?;
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

#[derive(Debug, Clone, serde::Deserialize)]
pub struct VersionManifestV2 {
    pub latest: Latest,
    pub versions: Vec<VersionRef>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Latest {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct VersionRef {
    pub id: String,
    pub url: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct VersionJson {
    pub downloads: Downloads,
    #[serde(rename = "javaVersion")]
    pub java_version: JavaVersion,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct JavaVersion {
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct Downloads {
    pub server: ServerDownload,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ServerDownload {
    pub sha1: String,
    pub size: u64,
    pub url: String,
}

pub struct ResolvedServerJar {
    pub version_id: String,
    pub jar_url: String,
    pub sha1: String,
    pub size: u64,
    pub java_major: u32,
}

fn manifest_url() -> String {
    std::env::var("ALLOY_MINECRAFT_MANIFEST_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json".to_string()
        })
}

pub async fn resolve_server_jar(version: &str) -> anyhow::Result<ResolvedServerJar> {
    let client = reqwest::Client::builder()
        .user_agent("alloy-agent")
        .timeout(Duration::from_secs(60))
        .build()?;

    let manifest: VersionManifestV2 = client
        .get(manifest_url())
        .send()
        .await
        .context("fetch version manifest")?
        .error_for_status()?
        .json()
        .await
        .context("parse version manifest")?;

    let version_id = if version == "latest_release" {
        manifest.latest.release
    } else {
        version.to_string()
    };

    let vref = manifest
        .versions
        .into_iter()
        .find(|v| v.id == version_id)
        .ok_or_else(|| anyhow::anyhow!("unknown minecraft version: {version}"))?;

    let vjson: VersionJson = client
        .get(&vref.url)
        .send()
        .await
        .context("fetch version json")?
        .error_for_status()?
        .json()
        .await
        .context("parse version json")?;

    Ok(ResolvedServerJar {
        version_id: vref.id,
        jar_url: vjson.downloads.server.url,
        sha1: vjson.downloads.server.sha1,
        size: vjson.downloads.server.size,
        java_major: vjson.java_version.major_version,
    })
}

pub fn cache_dir() -> PathBuf {
    crate::minecraft::data_root()
        .join("cache")
        .join("minecraft")
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

#[derive(Debug, Clone, serde::Serialize)]
struct MinecraftJarMeta {
    version_id: String,
    sha1: String,
    size_bytes: u64,
    java_major: u32,
    updated_at_unix_ms: u64,
}

fn write_meta_best_effort(entry_dir: &Path, resolved: &ResolvedServerJar) {
    let meta = MinecraftJarMeta {
        version_id: resolved.version_id.clone(),
        sha1: resolved.sha1.clone(),
        size_bytes: resolved.size,
        java_major: resolved.java_major,
        updated_at_unix_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
    };

    let path = entry_dir.join("meta.json");
    let tmp = entry_dir.join("meta.json.tmp");
    let Ok(json) = serde_json::to_vec_pretty(&meta) else {
        return;
    };
    if fs::write(&tmp, json).is_err() {
        let _ = fs::remove_file(&tmp);
        return;
    }
    if fs::rename(&tmp, &path).is_err() {
        let _ = fs::remove_file(&tmp);
    }
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

pub async fn ensure_server_jar(resolved: &ResolvedServerJar) -> anyhow::Result<PathBuf> {
    ensure_server_jar_with_progress(resolved, None::<fn(u64, u64, u64)>).await
}

pub async fn ensure_server_jar_with_progress<F>(
    resolved: &ResolvedServerJar,
    mut on_progress: Option<F>,
) -> anyhow::Result<PathBuf>
where
    F: FnMut(u64, u64, u64) + Send,
{
    let sha1_hex = &resolved.sha1;
    let jar_path = cache_dir().join(sha1_hex).join("server.jar");
    if jar_path.exists() {
        if let Some(dir) = jar_path.parent() {
            mark_last_used(dir);
            write_meta_best_effort(dir, resolved);
        }
        if let Some(cb) = on_progress.as_mut() {
            cb(resolved.size, resolved.size, 0);
        }
        return Ok(jar_path);
    }

    let lock_key = format!("minecraft:vanilla:{sha1_hex}");
    let lock = lock_for(&lock_key);
    let _guard = lock.lock().await;
    if jar_path.exists() {
        if let Some(dir) = jar_path.parent() {
            mark_last_used(dir);
            write_meta_best_effort(dir, resolved);
        }
        if let Some(cb) = on_progress.as_mut() {
            cb(resolved.size, resolved.size, 0);
        }
        return Ok(jar_path);
    }

    fs::create_dir_all(jar_path.parent().unwrap())?;

    let url = Url::parse(&resolved.jar_url)?;
    let mut last_err: Option<anyhow::Error> = None;
    let mut bytes: Option<Vec<u8>> = None;
    let mut last_report = DownloadReport {
        downloaded_bytes: 0,
        total_bytes: resolved.size,
        speed_bytes_per_sec: 0,
    };
    for attempt in 1..=3_u32 {
        let res: anyhow::Result<Vec<u8>> = (async {
            let (bytes, report) = download_bytes_with_progress(
                url.clone(),
                Some(resolved.size),
                |downloaded, total, speed| {
                    last_report = DownloadReport {
                        downloaded_bytes: downloaded,
                        total_bytes: total,
                        speed_bytes_per_sec: speed,
                    };
                    if let Some(cb) = on_progress.as_mut() {
                        cb(downloaded, total, speed);
                    }
                },
            )
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

    if bytes.len() as u64 != resolved.size {
        anyhow::bail!(
            "minecraft server.jar size mismatch: expected {} bytes, got {} bytes (url={} cache_path={})",
            resolved.size,
            bytes.len(),
            resolved.jar_url,
            jar_path.display()
        );
    }

    let got = sha1::Sha1::digest(bytes.as_slice());
    let got_hex = hex::encode(got);
    if got_hex != *sha1_hex {
        anyhow::bail!(
            "minecraft server.jar sha1 mismatch: expected {sha1_hex}, got {got_hex} (url={} cache_path={})",
            resolved.jar_url,
            jar_path.display()
        );
    }

    let tmp_path = jar_path.with_extension("tmp");
    let mut f = fs::File::create(&tmp_path)?;
    f.write_all(&bytes)?;
    f.sync_all()?;
    fs::rename(tmp_path, &jar_path)?;

    if let Some(cb) = on_progress.as_mut() {
        cb(
            resolved.size,
            resolved.size,
            last_report.speed_bytes_per_sec,
        );
    }

    if let Some(dir) = jar_path.parent() {
        mark_last_used(dir);
        write_meta_best_effort(dir, resolved);
    }
    Ok(jar_path)
}
