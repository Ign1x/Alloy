#![allow(dead_code)]

use std::{fs, io::Write, path::PathBuf};

use anyhow::Context;
use reqwest::Url;
use sha1::Digest;

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

pub async fn resolve_server_jar(version: &str) -> anyhow::Result<ResolvedServerJar> {
    let client = reqwest::Client::builder()
        .user_agent("alloy-agent")
        .build()?;

    let manifest_url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let manifest: VersionManifestV2 = client
        .get(manifest_url)
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

pub async fn ensure_server_jar(resolved: &ResolvedServerJar) -> anyhow::Result<PathBuf> {
    let sha1_hex = &resolved.sha1;
    let jar_path = cache_dir().join(sha1_hex).join("server.jar");
    if jar_path.exists() {
        return Ok(jar_path);
    }

    fs::create_dir_all(jar_path.parent().unwrap())?;

    let url = Url::parse(&resolved.jar_url)?;
    let bytes = reqwest::get(url)
        .await
        .context("download server.jar")?
        .error_for_status()?
        .bytes()
        .await
        .context("read server.jar body")?;

    if bytes.len() as u64 != resolved.size {
        anyhow::bail!(
            "size mismatch: expected {}, got {}",
            resolved.size,
            bytes.len()
        );
    }

    let got = sha1::Sha1::digest(bytes.as_ref());
    let got_hex = hex::encode(got);
    if got_hex != *sha1_hex {
        anyhow::bail!("sha1 mismatch: expected {sha1_hex}, got {got_hex}");
    }

    let tmp_path = jar_path.with_extension("tmp");
    let mut f = fs::File::create(&tmp_path)?;
    f.write_all(&bytes)?;
    f.sync_all()?;
    fs::rename(tmp_path, &jar_path)?;
    Ok(jar_path)
}
