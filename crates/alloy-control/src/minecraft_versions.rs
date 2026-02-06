use anyhow::Context;
use serde::Deserialize;
use specta::Type;
use std::{sync::OnceLock, time::Duration};

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

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("alloy-control")
            .timeout(Duration::from_secs(15))
            .build()
            .expect("failed to build reqwest client")
    })
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

    let url = manifest_url();
    let mut last_err: Option<anyhow::Error> = None;
    let mut manifest: Option<ManifestV2> = None;
    for attempt in 1..=3_u32 {
        let res: anyhow::Result<ManifestV2> = (async {
            http_client()
                .get(&url)
                .send()
                .await
                .with_context(|| format!("fetch version manifest (attempt {attempt})"))?
                .error_for_status()
                .context("manifest http status")?
                .json()
                .await
                .context("parse version manifest JSON")
        })
        .await;

        match res {
            Ok(v) => {
                manifest = Some(v);
                break;
            }
            Err(e) => {
                last_err = Some(e);
                if attempt < 3 {
                    tokio::time::sleep(Duration::from_millis(
                        250_u64.saturating_mul(attempt as u64),
                    ))
                    .await;
                }
            }
        }
    }

    let manifest = match manifest {
        Some(v) => v,
        None => {
            // Best-effort fallback: if we have any cached response (even stale), serve it.
            if let Some((_, v)) = &*cache().read().await {
                return Ok(v.clone());
            }
            return Err(
                last_err.unwrap_or_else(|| anyhow::anyhow!("fetch version manifest failed"))
            );
        }
    };

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
