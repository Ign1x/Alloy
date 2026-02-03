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
use reqwest::Url;
use tokio::sync::Mutex;

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
    let zip_path = cache_dir()
        .join(&resolved.version_id)
        .join(format!("terraria-server-{}.zip", resolved.version_id));
    if zip_path.exists() {
        return Ok(zip_path);
    }

    let lock_key = format!("terraria:vanilla:{}", resolved.version_id);
    let lock = lock_for(&lock_key);
    let _guard = lock.lock().await;
    if zip_path.exists() {
        return Ok(zip_path);
    }

    fs::create_dir_all(zip_path.parent().unwrap())?;

    let url = Url::parse(&resolved.zip_url)?;
    let mut last_err: Option<anyhow::Error> = None;
    let mut bytes: Option<Vec<u8>> = None;
    for attempt in 1..=3_u32 {
        let res: anyhow::Result<Vec<u8>> = (async {
            let resp = http_client()
                .get(url.clone())
                .send()
                .await
                .context("download terraria server zip")?
                .error_for_status()
                .context("download terraria server zip (status)")?;
            let b = resp
                .bytes()
                .await
                .context("read terraria server zip body")?;
            Ok(b.to_vec())
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
    let looks_complete = bin_x86_64.exists()
        && server_root.join("Content").is_dir()
        && (server_root.join("monoconfig").is_dir()
            || server_root.join("assemblies").is_dir()
            || server_root.join("lib64").is_dir())
        && (server_root.join("lib64").is_dir()
            || server_root.join("FNA.dll").is_file()
            || server_root.join("TerrariaServer.exe").is_file());
    if looks_complete {
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

    if !server_root.join("Content").is_dir() {
        let _ = fs::remove_dir_all(&server_root);
        anyhow::bail!(
            "terraria server extraction missing Content/ directory: {}",
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
