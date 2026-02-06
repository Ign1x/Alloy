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

fn github_repo() -> String {
    std::env::var("ALLOY_UPDATE_GITHUB_REPO").unwrap_or_else(|_| "Ign1x/Alloy".to_string())
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
struct CachedRelease {
    fetched_at: Instant,
    release: LatestRelease,
}

fn cache() -> &'static Mutex<Option<CachedRelease>> {
    static CACHE: OnceLock<Mutex<Option<CachedRelease>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub async fn latest_release() -> anyhow::Result<LatestRelease> {
    const TTL: Duration = Duration::from_secs(10 * 60);
    if let Some(hit) = cache()
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .filter(|c| c.fetched_at.elapsed() < TTL)
        .map(|c| c.release.clone())
    {
        return Ok(hit);
    }

    let release = fetch_latest_release().await?;
    *cache().lock().unwrap_or_else(|e| e.into_inner()) = Some(CachedRelease {
        fetched_at: Instant::now(),
        release: release.clone(),
    });
    Ok(release)
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

async fn fetch_latest_release() -> anyhow::Result<LatestRelease> {
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
    let token = std::env::var("ALLOY_UPDATE_WATCHTOWER_TOKEN").unwrap_or_default();
    !url.trim().is_empty() && !token.trim().is_empty()
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
        .unwrap_or_else(|_| "".to_string())
        .trim()
        .to_string();
    if token.is_empty() {
        anyhow::bail!("ALLOY_UPDATE_WATCHTOWER_TOKEN is not set");
    }

    let endpoint = format!("{}/v1/update", url.trim_end_matches('/'));
    let resp = http_client()
        .get(endpoint)
        .bearer_auth(token)
        .send()
        .await
        .context("request watchtower update")?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        anyhow::bail!("watchtower update failed ({status}): {text}");
    }

    Ok(text)
}
