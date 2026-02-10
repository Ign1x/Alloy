use anyhow::Context;
use reqwest::Url;
use serde::Deserialize;
use std::{sync::OnceLock, time::Duration};

const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";

#[derive(Debug, Clone)]
pub struct SaveSearchHit {
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    pub author: String,
    pub summary: Option<String>,
    pub page_url: String,
    pub icon_url: Option<String>,
    pub game_versions: Vec<String>,
    pub downloads: Option<u64>,
}

#[derive(Debug, Clone)]
pub struct ResolvedSaveDownload {
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
    pub title: String,
    pub page_url: String,
    pub download_url: String,
}

#[derive(Debug, Clone)]
pub struct ResolveSaveDownloadInput {
    pub provider: String,
    pub project_id: String,
    pub version_id: String,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchResponse {
    #[serde(default)]
    hits: Vec<ModrinthSearchHit>,
}

#[derive(Debug, Deserialize)]
struct ModrinthSearchHit {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    slug: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    author: Option<String>,
    #[serde(default)]
    versions: Option<Vec<String>>,
    #[serde(default)]
    latest_version: Option<String>,
    #[serde(default)]
    icon_url: Option<String>,
    #[serde(default)]
    downloads: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct ModrinthVersionResponse {
    #[serde(default)]
    id: String,
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version_number: Option<String>,
    #[serde(default)]
    files: Vec<ModrinthVersionFile>,
}

#[derive(Debug, Clone, Deserialize)]
struct ModrinthVersionFile {
    #[serde(default)]
    url: String,
    #[serde(default)]
    primary: Option<bool>,
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("alloy-control")
            .timeout(Duration::from_secs(20))
            .build()
            .expect("failed to build reqwest client")
    })
}

fn clamp_limit(limit: Option<u32>) -> u32 {
    let raw = limit.unwrap_or(10);
    raw.clamp(1, 20)
}

fn trim_non_empty(raw: Option<String>) -> Option<String> {
    raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

pub async fn search_minecraft_worlds(
    query: &str,
    limit: Option<u32>,
) -> anyhow::Result<Vec<SaveSearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        anyhow::bail!("query is required");
    }

    let mut url = Url::parse(&format!("{MODRINTH_API_BASE}/search"))
        .expect("MODRINTH_API_BASE should be valid");
    url.query_pairs_mut()
        .append_pair("query", q)
        .append_pair("index", "relevance")
        .append_pair("limit", &clamp_limit(limit).to_string())
        .append_pair("facets", r#"[["project_type:world"]]"#);

    let resp = http_client()
        .get(url)
        .send()
        .await
        .context("modrinth search")?
        .error_for_status()
        .context("modrinth search (status)")?
        .json::<ModrinthSearchResponse>()
        .await
        .context("parse modrinth search json")?;

    let mut out = Vec::<SaveSearchHit>::new();
    for hit in resp.hits {
        let project_id = hit.project_id.trim().to_string();
        if project_id.is_empty() {
            continue;
        }
        let Some(version_id) = trim_non_empty(hit.latest_version) else {
            continue;
        };

        let slug_or_id = trim_non_empty(hit.slug).unwrap_or_else(|| project_id.clone());
        let title = trim_non_empty(hit.title).unwrap_or_else(|| slug_or_id.clone());
        let author = trim_non_empty(hit.author).unwrap_or_else(|| "unknown".to_string());
        let page_url = format!("https://modrinth.com/world/{slug_or_id}");

        out.push(SaveSearchHit {
            provider: "modrinth".to_string(),
            project_id,
            version_id,
            title,
            author,
            summary: trim_non_empty(hit.description),
            page_url,
            icon_url: trim_non_empty(hit.icon_url),
            game_versions: hit
                .versions
                .unwrap_or_default()
                .into_iter()
                .take(8)
                .collect(),
            downloads: hit.downloads,
        });
    }

    Ok(out)
}

pub async fn resolve_save_download(
    input: ResolveSaveDownloadInput,
) -> anyhow::Result<ResolvedSaveDownload> {
    let provider = input.provider.trim().to_ascii_lowercase();
    if provider != "modrinth" {
        anyhow::bail!("unsupported provider: {}", input.provider);
    }

    let project_id = input.project_id.trim();
    if project_id.is_empty() {
        anyhow::bail!("project_id is required");
    }
    let version_id = input.version_id.trim();
    if version_id.is_empty() {
        anyhow::bail!("version_id is required");
    }

    let url = format!("{MODRINTH_API_BASE}/version/{version_id}");
    let version = http_client()
        .get(url)
        .send()
        .await
        .context("modrinth get version")?
        .error_for_status()
        .context("modrinth get version (status)")?
        .json::<ModrinthVersionResponse>()
        .await
        .context("parse modrinth version json")?;

    if version.project_id.trim() != project_id {
        anyhow::bail!("version does not belong to the selected project");
    }
    if version.id.trim() != version_id {
        anyhow::bail!("version mismatch");
    }

    let file = version
        .files
        .iter()
        .find(|f| f.primary.unwrap_or(false))
        .or_else(|| version.files.first())
        .ok_or_else(|| anyhow::anyhow!("modrinth version has no downloadable files"))?
        .clone();

    let parsed = Url::parse(file.url.trim()).context("invalid modrinth file url")?;
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("modrinth file url host is missing"))?
        .to_ascii_lowercase();
    if parsed.scheme() != "https"
        || !(host == "cdn.modrinth.com"
            || host == "modrinth.com"
            || host.ends_with(".modrinth.com"))
    {
        anyhow::bail!("modrinth file url host is not allowed");
    }

    let label = trim_non_empty(version.name)
        .or_else(|| trim_non_empty(version.version_number))
        .unwrap_or_else(|| "modrinth world".to_string());

    Ok(ResolvedSaveDownload {
        provider: "modrinth".to_string(),
        project_id: project_id.to_string(),
        version_id: version_id.to_string(),
        title: label,
        page_url: format!("https://modrinth.com/world/{project_id}"),
        download_url: parsed.to_string(),
    })
}
