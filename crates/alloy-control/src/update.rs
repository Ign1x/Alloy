use std::{
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct LatestRelease {
    pub tag_name: String,
    pub html_url: String,
    pub published_at: Option<String>,
    pub body: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct SimpleVersion {
    pub major: u64,
    pub minor: u64,
    pub patch: u64,
}

#[derive(Debug, Clone)]
pub struct UpdateCompatibility {
    pub control_min_agent: Option<String>,
    pub control_max_agent: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UpdateSource {
    Manifest,
    GithubReleaseLatest,
}

impl UpdateSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manifest => "manifest",
            Self::GithubReleaseLatest => "github_releases_latest",
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpdateCatalog {
    pub control: LatestRelease,
    pub agent: Option<LatestRelease>,
    pub source: UpdateSource,
    pub channel: Option<String>,
    pub manifest_url: Option<String>,
    pub compatibility: Option<UpdateCompatibility>,
    pub warning: Option<String>,
}

pub fn parse_simple_version(raw: &str) -> Option<SimpleVersion> {
    let s = raw.trim().trim_start_matches('v');
    let mut it = s.split(|c: char| matches!(c, '.' | '-' | '+'));
    let major = it.next()?.parse().ok()?;
    let minor = it.next()?.parse().ok()?;
    let patch = it.next()?.parse().ok()?;
    Some(SimpleVersion {
        major,
        minor,
        patch,
    })
}

fn clean_opt(raw: Option<String>) -> Option<String> {
    raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn github_repo() -> String {
    std::env::var("ALLOY_UPDATE_GITHUB_REPO").unwrap_or_else(|_| "Ign1x/Alloy".to_string())
}

fn update_manifest_url() -> Option<String> {
    std::env::var("ALLOY_UPDATE_MANIFEST_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("alloy-control")
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client")
    })
}

#[derive(Debug, Clone)]
struct CachedCatalog {
    fetched_at: Instant,
    catalog: UpdateCatalog,
}

fn cache() -> &'static Mutex<Option<CachedCatalog>> {
    static CACHE: OnceLock<Mutex<Option<CachedCatalog>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub async fn update_catalog() -> anyhow::Result<UpdateCatalog> {
    const TTL: Duration = Duration::from_secs(10 * 60);
    if let Some(hit) = cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .filter(|c| c.fetched_at.elapsed() < TTL)
        .map(|c| c.catalog.clone())
    {
        return Ok(hit);
    }

    let catalog = fetch_update_catalog().await?;
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = Some(CachedCatalog {
        fetched_at: Instant::now(),
        catalog: catalog.clone(),
    });
    Ok(catalog)
}

pub async fn update_catalog_force() -> anyhow::Result<UpdateCatalog> {
    let catalog = fetch_update_catalog().await?;
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = Some(CachedCatalog {
        fetched_at: Instant::now(),
        catalog: catalog.clone(),
    });
    Ok(catalog)
}

pub async fn latest_release() -> anyhow::Result<LatestRelease> {
    Ok(update_catalog().await?.control)
}

async fn fetch_update_catalog() -> anyhow::Result<UpdateCatalog> {
    let manifest_url = update_manifest_url();
    let mut manifest_error: Option<String> = None;

    if let Some(url) = manifest_url.as_ref() {
        match fetch_update_catalog_from_manifest(url).await {
            Ok(catalog) => return Ok(catalog),
            Err(err) => {
                manifest_error = Some(err.to_string());
            }
        }
    }

    let latest = fetch_latest_release_from_github().await?;
    Ok(UpdateCatalog {
        control: latest,
        agent: None,
        source: UpdateSource::GithubReleaseLatest,
        channel: None,
        manifest_url: manifest_url,
        compatibility: None,
        warning: manifest_error.map(|msg| {
            format!("update manifest unavailable, fell back to GitHub releases/latest: {msg}")
        }),
    })
}

#[derive(Debug, serde::Deserialize)]
struct UpdateManifest {
    #[serde(default)]
    schema: Option<u32>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    control: Option<ManifestRelease>,
    #[serde(default)]
    agent: Option<ManifestRelease>,
    #[serde(default)]
    compatibility: Option<ManifestCompatibilityRaw>,
}

#[derive(Debug, serde::Deserialize)]
struct ManifestRelease {
    #[serde(default)]
    tag: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
struct ManifestCompatibilityRaw {
    #[serde(default)]
    control_min_agent: Option<String>,
    #[serde(default)]
    control_max_agent: Option<String>,
    #[serde(default)]
    note: Option<String>,
}

fn map_manifest_release(
    release: ManifestRelease,
    fallback_published_at: Option<String>,
    repo: &str,
    component: &str,
) -> anyhow::Result<LatestRelease> {
    let version = clean_opt(release.version);
    let tag = clean_opt(release.tag)
        .or_else(|| {
            version.as_ref().map(|v| {
                if v.starts_with('v') {
                    v.clone()
                } else {
                    format!("v{v}")
                }
            })
        })
        .ok_or_else(|| anyhow::anyhow!("manifest {component} is missing tag/version"))?;

    let url = clean_opt(release.url)
        .unwrap_or_else(|| format!("https://github.com/{repo}/releases/tag/{tag}"));
    let published_at = clean_opt(release.published_at).or(fallback_published_at);
    let body = clean_opt(release.body);

    Ok(LatestRelease {
        tag_name: tag,
        html_url: url,
        published_at,
        body,
    })
}

async fn fetch_update_catalog_from_manifest(url: &str) -> anyhow::Result<UpdateCatalog> {
    let manifest = http_client()
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .with_context(|| format!("request update manifest: {url}"))?
        .error_for_status()
        .with_context(|| format!("update manifest returned non-2xx: {url}"))?
        .json::<UpdateManifest>()
        .await
        .with_context(|| format!("parse update manifest JSON: {url}"))?;

    if let Some(schema) = manifest.schema
        && schema != 1
    {
        anyhow::bail!("unsupported update manifest schema {schema} (expected 1)");
    }

    let fallback_published_at = clean_opt(manifest.published_at);
    let repo = github_repo();

    let control = map_manifest_release(
        manifest
            .control
            .ok_or_else(|| anyhow::anyhow!("manifest missing `control` release entry"))?,
        fallback_published_at.clone(),
        &repo,
        "control",
    )
    .context("invalid control release in update manifest")?;

    let agent = manifest
        .agent
        .map(|release| {
            map_manifest_release(release, fallback_published_at.clone(), &repo, "agent")
                .context("invalid agent release in update manifest")
        })
        .transpose()?;

    let compatibility = manifest.compatibility.and_then(|raw| {
        let control_min_agent = clean_opt(raw.control_min_agent);
        let control_max_agent = clean_opt(raw.control_max_agent);
        let note = clean_opt(raw.note);
        if control_min_agent.is_none() && control_max_agent.is_none() && note.is_none() {
            None
        } else {
            Some(UpdateCompatibility {
                control_min_agent,
                control_max_agent,
                note,
            })
        }
    });

    Ok(UpdateCatalog {
        control,
        agent,
        source: UpdateSource::Manifest,
        channel: clean_opt(manifest.channel),
        manifest_url: Some(url.to_string()),
        compatibility,
        warning: None,
    })
}

#[derive(Debug, serde::Deserialize)]
struct GitHubLatestRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    body: Option<String>,
}

async fn fetch_latest_release_from_github() -> anyhow::Result<LatestRelease> {
    let repo = github_repo();
    let url = format!("https://api.github.com/repos/{repo}/releases/latest");

    let token = std::env::var("ALLOY_GITHUB_TOKEN")
        .ok()
        .or_else(|| std::env::var("GITHUB_TOKEN").ok())
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty());

    let mut req = http_client()
        .get(url)
        .header("accept", "application/vnd.github+json");
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }

    let resp = req
        .send()
        .await
        .context("request github releases/latest")?
        .error_for_status()
        .context("github releases/latest returned non-2xx")?;

    let rel = resp
        .json::<GitHubLatestRelease>()
        .await
        .context("parse github releases/latest json")?;

    Ok(LatestRelease {
        tag_name: rel.tag_name,
        html_url: rel.html_url,
        published_at: rel.published_at,
        body: rel.body,
    })
}

pub fn watchtower_configured() -> bool {
    let url = std::env::var("ALLOY_UPDATE_WATCHTOWER_URL").unwrap_or_default();
    !url.trim().is_empty()
}

pub async fn trigger_watchtower_update() -> anyhow::Result<String> {
    let url = std::env::var("ALLOY_UPDATE_WATCHTOWER_URL")
        .unwrap_or_else(|_| "".to_string())
        .trim()
        .to_string();
    if url.is_empty() {
        anyhow::bail!("ALLOY_UPDATE_WATCHTOWER_URL is not set");
    }
    let token = std::env::var("ALLOY_UPDATE_WATCHTOWER_TOKEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let endpoint = format!("{}/v1/update", url.trim_end_matches('/'));
    let mut req = http_client().get(endpoint);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let resp = req.send().await.context("request watchtower update")?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("watchtower update failed ({status}): {text}");
    }

    Ok(text)
}
