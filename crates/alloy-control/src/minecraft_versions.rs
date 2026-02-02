use anyhow::Context;
use serde::Deserialize;
use specta::Type;
use std::sync::OnceLock;

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct MinecraftVersionRef {
    pub id: String,
    pub kind: String,
    pub release_time: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct MinecraftVersionsResponse {
    pub latest_release: String,
    pub latest_snapshot: String,
    pub versions: Vec<MinecraftVersionRef>,
}

#[derive(Debug, Clone, Deserialize)]
struct ManifestV2 {
    latest: Latest,
    versions: Vec<VersionRef>,
}

#[derive(Debug, Clone, Deserialize)]
struct Latest {
    release: String,
    snapshot: String,
}

#[derive(Debug, Clone, Deserialize)]
struct VersionRef {
    id: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(rename = "releaseTime")]
    release_time: String,
}

static MANIFEST_CACHE: OnceLock<
    tokio::sync::RwLock<Option<(std::time::Instant, MinecraftVersionsResponse)>>,
> = OnceLock::new();

fn cache() -> &'static tokio::sync::RwLock<Option<(std::time::Instant, MinecraftVersionsResponse)>>
{
    MANIFEST_CACHE.get_or_init(|| tokio::sync::RwLock::new(None))
}

pub async fn get_versions() -> anyhow::Result<MinecraftVersionsResponse> {
    // Keep it simple: small TTL cache.
    // Mojang CDN advertises max-age=120; we cache slightly longer to avoid spiky traffic.
    const TTL: std::time::Duration = std::time::Duration::from_secs(300);

    {
        let g = cache().read().await;
        if let Some((ts, v)) = &*g
            && ts.elapsed() < TTL
        {
            return Ok(v.clone());
        }
    }

    let url = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let manifest: ManifestV2 = reqwest::get(url)
        .await
        .context("fetch piston-meta version manifest")?
        .error_for_status()?
        .json()
        .await
        .context("parse version manifest JSON")?;

    let mut versions = manifest
        .versions
        .into_iter()
        .map(|v| MinecraftVersionRef {
            id: v.id,
            kind: v.kind,
            release_time: v.release_time,
        })
        .collect::<Vec<_>>();

    // Default order: newest first.
    versions.sort_by(|a, b| b.release_time.cmp(&a.release_time));

    let resp = MinecraftVersionsResponse {
        latest_release: manifest.latest.release,
        latest_snapshot: manifest.latest.snapshot,
        versions,
    };

    {
        let mut w = cache().write().await;
        *w = Some((std::time::Instant::now(), resp.clone()));
    }

    Ok(resp)
}
