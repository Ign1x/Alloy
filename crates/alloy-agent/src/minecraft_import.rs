use std::{
    collections::BTreeMap,
    fs,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::minecraft;

#[derive(Debug, Clone)]
pub struct ImportParams {
    pub pack: String,
    pub memory_mb: u32,
    pub port: u16,
}

fn normalize_rel_path(rel: &str) -> anyhow::Result<PathBuf> {
    if rel.trim().is_empty() {
        return Ok(PathBuf::new());
    }
    let p = Path::new(rel);
    if p.is_absolute() {
        anyhow::bail!("path must be relative to ALLOY_DATA_ROOT");
    }
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            Component::ParentDir => anyhow::bail!("path traversal is not allowed"),
            Component::Prefix(_) | Component::RootDir => {
                anyhow::bail!("path must be relative to ALLOY_DATA_ROOT")
            }
        }
    }
    Ok(out)
}

pub fn validate_params(params: &BTreeMap<String, String>) -> anyhow::Result<ImportParams> {
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

    let pack = params
        .get("pack")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("")
        .to_string();
    if pack.is_empty() {
        field_errors.insert(
            "pack".to_string(),
            "Required. Provide a server pack zip URL, or a path under /data.".to_string(),
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
            "invalid minecraft import params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(ImportParams {
        pack,
        memory_mb,
        port,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ImportMarker {
    source: String,
}

fn marker_path(instance_dir: &Path) -> PathBuf {
    instance_dir.join("import.json")
}

fn read_marker(instance_dir: &Path) -> Option<ImportMarker> {
    let raw = fs::read(marker_path(instance_dir)).ok()?;
    serde_json::from_slice::<ImportMarker>(&raw).ok()
}

fn write_marker(instance_dir: &Path, marker: &ImportMarker) -> anyhow::Result<()> {
    let p = marker_path(instance_dir);
    let tmp = p.with_extension("tmp");
    let data = serde_json::to_vec_pretty(marker)?;
    fs::write(&tmp, &data)?;
    fs::rename(tmp, p)?;
    Ok(())
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

async fn download_to_path(url: &str, path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let client = reqwest::Client::builder()
        .user_agent("alloy-agent")
        .timeout(Duration::from_secs(30 * 60))
        .build()
        .context("build http client")?;
    let resp = client
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

fn copy_dir(src: &Path, dst: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)? {
        let e = e?;
        let p = e.path();
        let name = e.file_name();
        let out = dst.join(name);
        let meta = fs::symlink_metadata(&p)?;
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            copy_dir(&p, &out)?;
            continue;
        }
        if meta.is_file() {
            if out.exists() {
                anyhow::bail!("destination exists: {}", out.display());
            }
            fs::copy(&p, &out)?;
        }
    }
    Ok(())
}

pub async fn ensure_imported(instance_dir: &Path, source: &str) -> anyhow::Result<()> {
    if let Some(m) = read_marker(instance_dir) {
        if m.source.trim() == source.trim() {
            return Ok(());
        }
        anyhow::bail!(
            "a different pack is already installed (installed={}, requested={})",
            m.source,
            source.trim()
        );
    }

    let src = source.trim();
    if src.is_empty() {
        anyhow::bail!("missing pack source");
    }

    // URL -> download zip; path -> local zip or directory under data root.
    if is_http_url(src) {
        let url = Url::parse(src).context("invalid pack url")?;
        if url.scheme() != "http" && url.scheme() != "https" {
            anyhow::bail!("pack url must be http(s)");
        }

        let imports = instance_dir.join("imports");
        tokio::fs::create_dir_all(&imports).await.ok();
        let nonce = alloy_process::ProcessId::new().0;
        let zip_path = imports.join(format!("pack-{nonce}.zip"));
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

        write_marker(
            instance_dir,
            &ImportMarker {
                source: src.to_string(),
            },
        )?;
        return Ok(());
    }

    let rel = normalize_rel_path(src)?;
    if rel.as_os_str().is_empty() {
        anyhow::bail!("pack path must be relative to ALLOY_DATA_ROOT");
    }
    let path = minecraft::data_root().join(&rel);
    let meta =
        fs::metadata(&path).with_context(|| format!("pack not found: {}", path.display()))?;
    if meta.is_dir() {
        tokio::task::spawn_blocking({
            let src_dir = path.clone();
            let dst_dir = instance_dir.to_path_buf();
            move || copy_dir(&src_dir, &dst_dir)
        })
        .await
        .context("copy task failed")??;

        write_marker(
            instance_dir,
            &ImportMarker {
                source: src.to_string(),
            },
        )?;
        return Ok(());
    }

    if !meta.is_file() {
        anyhow::bail!("pack path is not a file or directory");
    }

    let is_zip = path
        .to_string_lossy()
        .to_ascii_lowercase()
        .ends_with(".zip");
    if !is_zip {
        anyhow::bail!("pack path must be a .zip or a directory");
    }

    let imports = instance_dir.join("imports");
    tokio::fs::create_dir_all(&imports).await.ok();
    let nonce = alloy_process::ProcessId::new().0;
    let extracted = imports.join(format!("extracted-{nonce}"));
    tokio::task::spawn_blocking({
        let zip_path = path.clone();
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

    write_marker(
        instance_dir,
        &ImportMarker {
            source: src.to_string(),
        },
    )?;
    Ok(())
}
