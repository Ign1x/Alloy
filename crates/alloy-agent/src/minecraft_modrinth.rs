use std::{
    collections::{BTreeMap, HashMap},
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
use reqwest::Url;
use serde::Deserialize;
use sha1::Digest;
use tokio::sync::Mutex;

use crate::minecraft;

#[derive(Debug, Clone)]
pub struct ModrinthParams {
    pub mrpack: String,
    pub memory_mb: u32,
    pub port: u16,
}

pub fn validate_params(params: &BTreeMap<String, String>) -> anyhow::Result<ModrinthParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    match params.get("accept_eula").map(|v| v.trim()) {
        Some("true") => {}
        _ => {
            field_errors.insert(
                "accept_eula".to_string(),
                "Required. You must accept the Minecraft EULA.".to_string(),
            );
        }
    }

    let mrpack = params
        .get("mrpack")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("")
        .to_string();
    if mrpack.is_empty() {
        field_errors.insert(
            "mrpack".to_string(),
            "Required. Paste a Modrinth version link or a direct .mrpack URL.".to_string(),
        );
    }

    let memory_mb = match params
        .get("memory_mb")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 2048,
        Some(raw) => match raw.parse::<u32>() {
            Ok(v) => v,
            Err(_) => {
                field_errors.insert(
                    "memory_mb".to_string(),
                    "Must be an integer (MiB), e.g. 2048.".to_string(),
                );
                2048
            }
        },
    };
    if !(512..=65536).contains(&memory_mb) {
        field_errors.insert(
            "memory_mb".to_string(),
            "Must be between 512 and 65536 (MiB).".to_string(),
        );
    }

    let port = match params
        .get("port")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 0,
        Some(raw) => match raw.parse::<u16>() {
            Ok(0) => 0,
            Ok(v) if v >= 1024 => v,
            Ok(v) => {
                field_errors.insert(
                    "port".to_string(),
                    format!("Must be 0 (auto) or in 1024..65535 (got {v})."),
                );
                v
            }
            Err(_) => {
                field_errors.insert(
                    "port".to_string(),
                    "Must be an integer (0 for auto, or 1024..65535).".to_string(),
                );
                0
            }
        },
    };

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid minecraft modrinth params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(ModrinthParams {
        mrpack,
        memory_mb,
        port,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledMarker {
    pub source: String,
    pub resolved_mrpack_url: String,
    pub minecraft: String,
    pub loader: String,
    pub loader_version: String,
}

#[derive(Debug, Clone)]
pub struct InstalledPack {
    pub minecraft: String,
    pub loader: String,
    pub loader_version: String,
}

fn cache_dir() -> PathBuf {
    minecraft::data_root()
        .join("cache")
        .join("minecraft")
        .join("modrinth")
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

fn normalize_rel_path(rel: &str) -> anyhow::Result<PathBuf> {
    if rel.trim().is_empty() {
        return Ok(PathBuf::new());
    }
    let p = Path::new(rel);
    if p.is_absolute() {
        anyhow::bail!("path must be relative");
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            Component::ParentDir => anyhow::bail!("path traversal is not allowed"),
            Component::Prefix(_) | Component::RootDir => anyhow::bail!("path must be relative"),
        }
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionResp {
    files: Vec<ModrinthVersionFile>,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionFile {
    url: String,
    filename: String,
    primary: Option<bool>,
}

async fn resolve_mrpack_url(source: &str) -> anyhow::Result<String> {
    let raw = source.trim();
    if raw.is_empty() {
        anyhow::bail!("missing mrpack source");
    }
    if raw.to_ascii_lowercase().ends_with(".mrpack") {
        return Ok(raw.to_string());
    }

    let url = Url::parse(raw).context("invalid mrpack url")?;
    let host = url.host_str().unwrap_or_default();
    if host.contains("modrinth.com") {
        // Common format: https://modrinth.com/modpack/<slug>/version/<version_id>
        let segs: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
        if let Some(i) = segs.iter().position(|s| *s == "version") {
            if let Some(version_id) = segs.get(i + 1) {
                let api = format!("https://api.modrinth.com/v2/version/{version_id}");
                let resp = http_client()
                    .get(api)
                    .send()
                    .await
                    .context("fetch modrinth version")?
                    .error_for_status()
                    .context("fetch modrinth version (status)")?
                    .json::<ModrinthVersionResp>()
                    .await
                    .context("parse modrinth version json")?;

                let mut candidates: Vec<&ModrinthVersionFile> = resp
                    .files
                    .iter()
                    .filter(|f| f.filename.to_ascii_lowercase().ends_with(".mrpack"))
                    .collect();
                candidates.sort_by_key(|f| !(f.primary.unwrap_or(false)));
                let file = candidates
                    .first()
                    .ok_or_else(|| anyhow::anyhow!("no .mrpack file found for that version"))?;
                return Ok(file.url.clone());
            }
        }
    }

    anyhow::bail!(
        "unsupported mrpack source; paste a Modrinth version link or a direct .mrpack URL"
    );
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
    let _ = tokio::fs::rename(&tmp, path).await;
    Ok(())
}

async fn ensure_mrpack_downloaded(resolved_url: &str) -> anyhow::Result<PathBuf> {
    let url_hash = {
        let mut h = sha1::Sha1::new();
        h.update(resolved_url.as_bytes());
        hex::encode(h.finalize())
    };
    let pack_path = cache_dir().join("packs").join(format!("{url_hash}.mrpack"));
    if pack_path.exists() {
        if let Some(dir) = pack_path.parent() {
            mark_last_used(dir);
        }
        return Ok(pack_path);
    }

    let lock_key = format!("modrinth:mrpack:{url_hash}");
    let lock = lock_for(&lock_key);
    let _guard = lock.lock().await;
    if pack_path.exists() {
        if let Some(dir) = pack_path.parent() {
            mark_last_used(dir);
        }
        return Ok(pack_path);
    }

    download_to_path(resolved_url, &pack_path).await?;
    if let Some(dir) = pack_path.parent() {
        mark_last_used(dir);
    }
    Ok(pack_path)
}

#[derive(Debug, Deserialize)]
struct MrpackIndex {
    #[allow(dead_code)]
    format_version: u32,
    #[allow(dead_code)]
    game: String,
    #[serde(default)]
    version_id: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    files: Vec<MrpackFile>,
    #[serde(default)]
    dependencies: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct MrpackFile {
    path: String,
    #[serde(default)]
    downloads: Vec<String>,
    #[serde(default)]
    file_size: Option<u64>,
    #[serde(default)]
    env: Option<MrpackEnv>,
}

#[derive(Debug, Deserialize)]
struct MrpackEnv {
    #[serde(default)]
    server: Option<String>,
}

fn load_mrpack_index(zip_path: &Path) -> anyhow::Result<(MrpackIndex, zip::ZipArchive<fs::File>)> {
    let f = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(f)?;

    let idx = {
        let mut index_file = archive
            .by_name("modrinth.index.json")
            .context("missing modrinth.index.json")?;
        let mut buf = Vec::<u8>::new();
        std::io::Read::read_to_end(&mut index_file, &mut buf)?;
        serde_json::from_slice::<MrpackIndex>(&buf).context("parse modrinth.index.json")?
    };
    Ok((idx, archive))
}

#[derive(Debug, Deserialize)]
struct FabricInstallerVersion {
    version: String,
    stable: bool,
}

async fn latest_fabric_installer_version() -> anyhow::Result<String> {
    let list = http_client()
        .get("https://meta.fabricmc.net/v2/versions/installer")
        .send()
        .await
        .context("fetch fabric installer versions")?
        .error_for_status()
        .context("fetch fabric installer versions (status)")?
        .json::<Vec<FabricInstallerVersion>>()
        .await
        .context("parse fabric installer versions")?;

    for v in &list {
        if v.stable {
            return Ok(v.version.clone());
        }
    }
    let v = list
        .first()
        .map(|v| v.version.clone())
        .ok_or_else(|| anyhow::anyhow!("no fabric installer versions"))?;
    Ok(v)
}

async fn ensure_fabric_server_jar(
    instance_dir: &Path,
    minecraft_version: &str,
    loader_version: &str,
) -> anyhow::Result<()> {
    let installer = latest_fabric_installer_version().await?;
    let url = format!(
        "https://meta.fabricmc.net/v2/versions/loader/{minecraft_version}/{loader_version}/{installer}/server/jar"
    );
    let jar = instance_dir.join("server.jar");
    if jar.exists() {
        return Ok(());
    }
    download_to_path(&url, &jar).await?;
    Ok(())
}

fn read_marker(instance_dir: &Path) -> Option<InstalledMarker> {
    let p = instance_dir.join("modrinth.json");
    let raw = fs::read(&p).ok()?;
    serde_json::from_slice::<InstalledMarker>(&raw).ok()
}

fn write_marker(instance_dir: &Path, marker: &InstalledMarker) -> anyhow::Result<()> {
    let p = instance_dir.join("modrinth.json");
    let tmp = p.with_extension("tmp");
    let data = serde_json::to_vec_pretty(marker)?;
    let mut f = fs::File::create(&tmp)?;
    f.write_all(&data)?;
    f.sync_all().ok();
    fs::rename(tmp, p)?;
    Ok(())
}

pub async fn ensure_installed(instance_dir: &Path, source: &str) -> anyhow::Result<InstalledPack> {
    if let Some(m) = read_marker(instance_dir) {
        if m.source.trim() == source.trim() {
            return Ok(InstalledPack {
                minecraft: m.minecraft,
                loader: m.loader,
                loader_version: m.loader_version,
            });
        }
    }

    let resolved_url = resolve_mrpack_url(source).await?;
    let mrpack_path = ensure_mrpack_downloaded(&resolved_url).await?;

    // Parse index + keep archive to read overrides.
    let (index, mut archive) = load_mrpack_index(&mrpack_path)?;

    let mc_version = index
        .dependencies
        .get("minecraft")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| anyhow::anyhow!("mrpack missing minecraft dependency"))?;

    let (loader, loader_version) = if let Some(v) = index.dependencies.get("fabric-loader") {
        ("fabric".to_string(), v.trim().to_string())
    } else if let Some(v) = index.dependencies.get("quilt-loader") {
        ("quilt".to_string(), v.trim().to_string())
    } else if index.dependencies.contains_key("forge")
        || index.dependencies.contains_key("neoforge")
    {
        anyhow::bail!("forge/neoforge modpacks are not supported yet");
    } else {
        anyhow::bail!("unsupported modpack loader (expected fabric-loader)");
    };

    if loader != "fabric" {
        anyhow::bail!("only fabric-loader modpacks are supported for now");
    }

    ensure_fabric_server_jar(instance_dir, &mc_version, &loader_version).await?;

    // Download listed server files.
    for (idx, f) in index.files.iter().enumerate() {
        let server_mode = f
            .env
            .as_ref()
            .and_then(|e| e.server.as_ref())
            .map(|s| s.trim().to_ascii_lowercase());
        if server_mode.as_deref() == Some("unsupported") {
            continue;
        }
        let rel = normalize_rel_path(&f.path)?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let dst = instance_dir.join(&rel);
        if let Some(parent) = dst.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        if let (Ok(meta), Some(expected)) = (tokio::fs::metadata(&dst).await, f.file_size) {
            if meta.is_file() && meta.len() == expected {
                continue;
            }
        }

        let url = f
            .downloads
            .first()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .ok_or_else(|| anyhow::anyhow!("missing download url for {}", f.path))?;
        download_to_path(url, &dst)
            .await
            .with_context(|| format!("download file {idx}"))?;
    }

    // Extract overrides/ into instance root.
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        let trimmed = name.trim_end_matches('/');
        if trimmed.is_empty() || !trimmed.starts_with("overrides/") {
            continue;
        }
        let rest = trimmed.strip_prefix("overrides/").unwrap_or("");
        if rest.is_empty() {
            continue;
        }
        let rel = normalize_rel_path(rest)?;
        let out_path = instance_dir.join(&rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp = out_path.with_extension("tmp");
        let mut out = fs::File::create(&tmp)?;
        std::io::copy(&mut file, &mut out)?;
        out.sync_all().ok();
        fs::rename(&tmp, &out_path)?;
    }

    write_marker(
        instance_dir,
        &InstalledMarker {
            source: source.trim().to_string(),
            resolved_mrpack_url: resolved_url.clone(),
            minecraft: mc_version.clone(),
            loader: loader.clone(),
            loader_version: loader_version.clone(),
        },
    )?;

    Ok(InstalledPack {
        minecraft: mc_version,
        loader,
        loader_version,
    })
}
