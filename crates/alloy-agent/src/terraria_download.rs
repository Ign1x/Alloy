#![allow(dead_code)]

use std::{fs, io::Write, path::PathBuf};

use anyhow::Context;
use reqwest::Url;

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
    let zip_path = cache_dir()
        .join(&resolved.version_id)
        .join(format!("terraria-server-{}.zip", resolved.version_id));
    if zip_path.exists() {
        return Ok(zip_path);
    }

    fs::create_dir_all(zip_path.parent().unwrap())?;

    let url = Url::parse(&resolved.zip_url)?;
    let bytes = reqwest::get(url)
        .await
        .context("download terraria server zip")?
        .error_for_status()?
        .bytes()
        .await
        .context("read terraria server zip body")?;

    // No official first-party checksums are provided by Re-Logic for the ZIP.
    // We store the bytes as-is and rely on TLS + stable URL pattern.

    let tmp_path = zip_path.with_extension("tmp");
    let mut f = fs::File::create(&tmp_path)?;
    f.write_all(&bytes)?;
    f.sync_all()?;
    fs::rename(tmp_path, &zip_path)?;
    Ok(zip_path)
}

pub fn extract_linux_x64_to_cache(
    zip_path: &PathBuf,
    version_id: &str,
) -> anyhow::Result<ExtractedLinuxServer> {
    // IMPORTANT: do NOT extract only the native binary.
    // Terraria expects sidecar files (monoconfig/assemblies/Content) to exist in its working dir.
    let server_root = cache_dir().join(version_id).join("linux-x64");
    let bin_x86_64 = server_root.join("TerrariaServer.bin.x86_64");
    let launcher = server_root.join("TerrariaServer");

    if bin_x86_64.exists() {
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

    fs::create_dir_all(&server_root)?;

    let f = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(f).context("open terraria server zip")?;

    // Extract everything under */Linux/ into server_root.
    for i in 0..archive.len() {
        let mut file = archive.by_index(i).context("read zip entry")?;
        let name = file.name();
        if !name.contains("/Linux/") {
            continue;
        }

        // Strip the leading path up to and including "/Linux/".
        let rel = match name.split_once("/Linux/") {
            Some((_, rest)) => rest,
            None => continue,
        };
        if rel.is_empty() {
            continue;
        }

        let out_path = server_root.join(rel);
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
