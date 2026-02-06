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
use tokio::sync::Mutex;

use crate::minecraft;

const CF_API_BASE: &str = "https://api.curseforge.com/v1";
const CF_GAME_ID_MINECRAFT: u32 = 432;
const CF_CLASS_ID_MODPACKS: u32 = 4471;

#[derive(Debug, Clone)]
pub struct CurseforgeParams {
    pub source: String,
    pub api_key: String,
    pub memory_mb: u32,
    pub port: u16,
}

pub fn validate_params(params: &BTreeMap<String, String>) -> anyhow::Result<CurseforgeParams> {
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

    let source = params
        .get("curseforge")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("")
        .to_string();
    if source.is_empty() {
        field_errors.insert(
            "curseforge".to_string(),
            "Required. Paste a CurseForge file URL, or modId:fileId.".to_string(),
        );
    }

    let api_key = params
        .get("curseforge_api_key")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("")
        .to_string();
    if api_key.is_empty() {
        // This is typically injected by the control plane.
        field_errors.insert(
            "curseforge".to_string(),
            "CurseForge API key is not configured. Set it in control-plane settings.".to_string(),
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
            "invalid minecraft curseforge params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(CurseforgeParams {
        source,
        api_key,
        memory_mb,
        port,
    })
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct InstalledMarker {
    pub source: String,
    pub mod_id: u32,
    pub file_id: u32,
    pub server_pack_file_id: u32,
    pub download_url: String,
}

fn marker_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join("curseforge.json")
}

fn read_marker(instance_dir: &Path) -> Option<InstalledMarker> {
    let raw = fs::read(marker_path(instance_dir)).ok()?;
    serde_json::from_slice::<InstalledMarker>(&raw).ok()
}

fn write_marker(instance_dir: &Path, marker: &InstalledMarker) -> anyhow::Result<()> {
    let p = marker_path(instance_dir);
    let tmp = p.with_extension("tmp");
    let data = serde_json::to_vec_pretty(marker)?;
    let mut f = fs::File::create(&tmp)?;
    f.write_all(&data)?;
    f.sync_all().ok();
    fs::rename(tmp, p)?;
    Ok(())
}

fn cache_dir() -> PathBuf {
    minecraft::data_root()
        .join("cache")
        .join("minecraft")
        .join("curseforge")
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

fn extract_zip_safely(zip_path: &Path, out_dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(out_dir)?;
    let f = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(f)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        let trimmed = name.trim_end_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        let rel =
            normalize_rel_path(trimmed).with_context(|| format!("invalid zip path {trimmed:?}"))?;
        if rel.as_os_str().is_empty() {
            continue;
        }
        let out_path = out_dir.join(&rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let tmp_path = out_path.with_extension("tmp");
        let mut out = fs::File::create(&tmp_path)?;
        std::io::copy(&mut file, &mut out)?;
        out.sync_all().ok();
        fs::rename(&tmp_path, &out_path)?;
    }
    Ok(())
}

fn find_flatten_root(extracted: &Path) -> PathBuf {
    let rd = match fs::read_dir(extracted) {
        Ok(v) => v,
        Err(_) => return extracted.to_path_buf(),
    };
    let mut entries: Vec<PathBuf> = rd
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name == "__MACOSX" || name == ".DS_Store" {
                return false;
            }
            true
        })
        .collect();
    if entries.len() != 1 {
        return extracted.to_path_buf();
    }
    let only = entries.remove(0);
    if only.is_dir() {
        only
    } else {
        extracted.to_path_buf()
    }
}

fn merge_dir(src: &Path, dst: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let p = e.path();
        let name = e.file_name();
        let dst_path = dst.join(name);
        let meta = fs::symlink_metadata(&p)?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            if dst_path.exists() && !dst_path.is_dir() {
                anyhow::bail!(
                    "destination exists and is not a directory: {}",
                    dst_path.display()
                );
            }
            merge_dir(&p, &dst_path)?;
            fs::remove_dir_all(&p).ok();
            continue;
        }
        if meta.is_file() {
            if dst_path.exists() {
                anyhow::bail!("destination exists: {}", dst_path.display());
            }
            fs::rename(&p, &dst_path)?;
        }
    }
    Ok(())
}

fn move_flattened_into_instance(extracted_root: &Path, instance_dir: &Path) -> anyhow::Result<()> {
    for e in fs::read_dir(extracted_root)? {
        let e = e?;
        let src_path = e.path();
        let name = e.file_name();
        let dst_path = instance_dir.join(name);
        let meta = fs::symlink_metadata(&src_path)?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if !dst_path.exists() {
            fs::rename(&src_path, &dst_path)?;
            continue;
        }
        if meta.is_dir() && dst_path.is_dir() {
            merge_dir(&src_path, &dst_path)?;
            fs::remove_dir_all(&src_path).ok();
            continue;
        }
        anyhow::bail!("destination exists: {}", dst_path.display());
    }
    Ok(())
}

fn is_http_url(s: &str) -> bool {
    let lower = s.trim().to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://")
}

#[derive(Debug, Clone)]
struct ModFileRef {
    mod_id: Option<u32>,
    file_id: u32,
    slug: Option<String>,
}

fn parse_digits(s: &str) -> Option<u32> {
    let v = s.trim();
    if v.is_empty() || !v.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    v.parse::<u32>().ok()
}

fn parse_source(source: &str) -> anyhow::Result<ModFileRef> {
    let s = source.trim();
    if s.is_empty() {
        anyhow::bail!("missing curseforge source");
    }

    if is_http_url(s) {
        let url = Url::parse(s).context("invalid url")?;
        let host = url.host_str().unwrap_or_default();
        if !host.contains("curseforge.com") {
            // Direct download URL (e.g. forgecdn). Treat as file_id-only.
            return Ok(ModFileRef {
                mod_id: None,
                file_id: 0,
                slug: None,
            });
        }

        let segs: Vec<&str> = url.path().split('/').filter(|s| !s.is_empty()).collect();
        let file_id = segs
            .iter()
            .position(|x| *x == "files")
            .and_then(|i| segs.get(i + 1))
            .and_then(|v| parse_digits(v))
            .ok_or_else(|| anyhow::anyhow!("curseforge url must include /files/<file_id>"))?;
        let slug = segs
            .iter()
            .position(|x| *x == "modpacks")
            .and_then(|i| segs.get(i + 1))
            .map(|s| s.to_string());
        return Ok(ModFileRef {
            mod_id: None,
            file_id,
            slug,
        });
    }

    // modId:fileId or modId/fileId
    if let Some((a, b)) = s.split_once(':').or_else(|| s.split_once('/')) {
        if let (Some(mod_id), Some(file_id)) = (parse_digits(a), parse_digits(b)) {
            return Ok(ModFileRef {
                mod_id: Some(mod_id),
                file_id,
                slug: None,
            });
        }
    }

    anyhow::bail!("unsupported curseforge source; paste a file URL or modId:fileId");
}

#[derive(Debug, Deserialize)]
struct SearchModsResponse {
    data: Vec<SearchModHit>,
}

#[derive(Debug, Deserialize)]
struct SearchModHit {
    id: u32,
    #[serde(default)]
    slug: Option<String>,
}

async fn resolve_mod_id_by_slug(api_key: &str, slug: &str) -> anyhow::Result<u32> {
    let mut url = Url::parse(&format!("{CF_API_BASE}/mods/search"))
        .expect("CF_API_BASE should be a valid URL");
    url.query_pairs_mut()
        .append_pair("gameId", &CF_GAME_ID_MINECRAFT.to_string())
        .append_pair("classId", &CF_CLASS_ID_MODPACKS.to_string())
        .append_pair("slug", slug);
    let resp = http_client()
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .context("curseforge search")?
        .error_for_status()
        .context("curseforge search (status)")?
        .json::<SearchModsResponse>()
        .await
        .context("parse curseforge search json")?;

    let hit = resp
        .data
        .into_iter()
        .next()
        .ok_or_else(|| anyhow::anyhow!("curseforge mod not found for slug {slug:?}"))?;
    Ok(hit.id)
}

#[derive(Debug, Deserialize)]
struct ModFileResponse {
    data: ModFile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModFile {
    id: u32,
    #[serde(default)]
    is_server_pack: bool,
    #[serde(default)]
    server_pack_file_id: u32,
}

async fn get_mod_file(api_key: &str, mod_id: u32, file_id: u32) -> anyhow::Result<ModFile> {
    let url = format!("{CF_API_BASE}/mods/{mod_id}/files/{file_id}");
    let resp = http_client()
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .context("curseforge get file")?
        .error_for_status()
        .context("curseforge get file (status)")?
        .json::<ModFileResponse>()
        .await
        .context("parse curseforge file json")?;
    Ok(resp.data)
}

#[derive(Debug, Deserialize)]
struct DownloadUrlResponse {
    data: String,
}

async fn get_download_url(api_key: &str, mod_id: u32, file_id: u32) -> anyhow::Result<String> {
    let url = format!("{CF_API_BASE}/mods/{mod_id}/files/{file_id}/download-url");
    let resp = http_client()
        .get(url)
        .header("x-api-key", api_key)
        .send()
        .await
        .context("curseforge get download url")?
        .error_for_status()
        .context("curseforge get download url (status)")?
        .json::<DownloadUrlResponse>()
        .await
        .context("parse curseforge download url json")?;
    let out = resp.data.trim().to_string();
    if out.is_empty() {
        anyhow::bail!("curseforge download url is empty");
    }
    Ok(out)
}

async fn download_to_path(url: &str, path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let resp = http_client()
        .get(url)
        .send()
        .await
        .context("download")?
        .error_for_status()
        .context("download (status)")?;

    let mut f = tokio::fs::File::create(path)
        .await
        .context("create download file")?;
    let mut total: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("download chunk")?;
        total = total.saturating_add(chunk.len() as u64);
        // Hard safety limit: 8GiB.
        if total > 8 * 1024 * 1024 * 1024_u64 {
            let _ = tokio::fs::remove_file(path).await;
            anyhow::bail!("download too large");
        }
        tokio::io::AsyncWriteExt::write_all(&mut f, &chunk)
            .await
            .context("write download")?;
    }
    tokio::io::AsyncWriteExt::flush(&mut f).await.ok();
    Ok(())
}

async fn ensure_server_pack_downloaded(
    api_key: &str,
    mod_id: u32,
    file_id: u32,
) -> anyhow::Result<(u32, String, PathBuf)> {
    // Resolve server pack file id + download URL.
    let file = get_mod_file(api_key, mod_id, file_id).await?;
    let server_pack_file_id = if file.is_server_pack {
        file.id
    } else if file.server_pack_file_id > 0 {
        file.server_pack_file_id
    } else {
        anyhow::bail!(
            "no server pack is available for this modpack file (try another file version or import a server pack manually)"
        );
    };

    let url = get_download_url(api_key, mod_id, server_pack_file_id).await?;

    let entry = cache_dir().join(server_pack_file_id.to_string());
    tokio::fs::create_dir_all(&entry).await.ok();
    mark_last_used(&entry);
    let zip_path = entry.join("server-pack.zip");

    // Coalesce concurrent downloads for the same server-pack file id.
    let lock = lock_for(&format!("cf:{server_pack_file_id}"));
    let _guard = lock.lock().await;

    if !zip_path.exists() {
        download_to_path(&url, &zip_path).await?;
    }

    Ok((server_pack_file_id, url, zip_path))
}

pub async fn ensure_installed(
    instance_dir: &Path,
    source: &str,
    api_key: &str,
) -> anyhow::Result<InstalledMarker> {
    if let Some(m) = read_marker(instance_dir) {
        if m.source.trim() == source.trim() {
            return Ok(m);
        }
    }

    let src = source.trim();
    let parsed = parse_source(src)?;

    // Direct download URL path: supported if the user pastes a forgecdn/other zip URL.
    if is_http_url(src) {
        let url = Url::parse(src).context("invalid url")?;
        let host = url.host_str().unwrap_or_default();
        if !host.contains("curseforge.com") {
            let imports = instance_dir.join("imports");
            tokio::fs::create_dir_all(&imports).await.ok();
            let nonce = alloy_process::ProcessId::new().0;
            let zip_path = imports.join(format!("curseforge-{nonce}.zip"));
            download_to_path(src, &zip_path).await?;

            let extracted = imports.join(format!("extracted-{nonce}"));
            tokio::task::spawn_blocking({
                let zip_path = zip_path.clone();
                let extracted = extracted.clone();
                move || extract_zip_safely(&zip_path, &extracted)
            })
            .await
            .context("extract task failed")??;

            let root = find_flatten_root(&extracted);
            tokio::task::spawn_blocking({
                let root = root.clone();
                let instance_dir = instance_dir.to_path_buf();
                move || move_flattened_into_instance(&root, &instance_dir)
            })
            .await
            .context("install task failed")??;

            let _ = tokio::fs::remove_dir_all(&extracted).await;
            let _ = tokio::fs::remove_file(&zip_path).await;

            let marker = InstalledMarker {
                source: src.to_string(),
                mod_id: 0,
                file_id: 0,
                server_pack_file_id: 0,
                download_url: src.to_string(),
            };
            write_marker(instance_dir, &marker)?;
            return Ok(marker);
        }
    }

    let file_id = parsed.file_id;
    let mod_id = match parsed.mod_id {
        Some(id) => id,
        None => {
            let slug = parsed
                .slug
                .as_deref()
                .filter(|s| !s.trim().is_empty())
                .ok_or_else(|| anyhow::anyhow!("missing modpack slug in curseforge url"))?;
            resolve_mod_id_by_slug(api_key, slug).await?
        }
    };

    let (server_pack_file_id, download_url, zip_path) =
        ensure_server_pack_downloaded(api_key, mod_id, file_id).await?;

    let imports = instance_dir.join("imports");
    tokio::fs::create_dir_all(&imports).await.ok();
    let nonce = alloy_process::ProcessId::new().0;
    let extracted = imports.join(format!("extracted-{nonce}"));
    tokio::task::spawn_blocking({
        let zip_path = zip_path.clone();
        let extracted = extracted.clone();
        move || extract_zip_safely(&zip_path, &extracted)
    })
    .await
    .context("extract task failed")??;

    let root = find_flatten_root(&extracted);
    tokio::task::spawn_blocking({
        let root = root.clone();
        let instance_dir = instance_dir.to_path_buf();
        move || move_flattened_into_instance(&root, &instance_dir)
    })
    .await
    .context("install task failed")??;

    let _ = tokio::fs::remove_dir_all(&extracted).await;

    let marker = InstalledMarker {
        source: src.to_string(),
        mod_id,
        file_id,
        server_pack_file_id,
        download_url,
    };
    write_marker(instance_dir, &marker)?;
    Ok(marker)
}
