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
pub enum UpdatePrecheckStatus {
    Updatable,
    NotUpdatable,
    NeedsManualConfirmation,
}

impl UpdatePrecheckStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Updatable => "updatable",
            Self::NotUpdatable => "not_updatable",
            Self::NeedsManualConfirmation => "needs_manual_confirmation",
        }
    }
}

#[derive(Debug, Clone)]
pub struct UpdatePrecheck {
    pub status: UpdatePrecheckStatus,
    pub reason_code: String,
    pub detail: String,
}

impl UpdatePrecheck {
    fn updatable(reason_code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            status: UpdatePrecheckStatus::Updatable,
            reason_code: reason_code.into(),
            detail: detail.into(),
        }
    }

    fn not_updatable(reason_code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            status: UpdatePrecheckStatus::NotUpdatable,
            reason_code: reason_code.into(),
            detail: detail.into(),
        }
    }

    fn needs_manual(reason_code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            status: UpdatePrecheckStatus::NeedsManualConfirmation,
            reason_code: reason_code.into(),
            detail: detail.into(),
        }
    }
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
    pub precheck: UpdatePrecheck,
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

fn merge_warning(current: Option<String>, extra: Option<String>) -> Option<String> {
    match (current, extra) {
        (Some(mut left), Some(right)) => {
            if !left.ends_with('.') {
                left.push('.');
            }
            left.push(' ');
            left.push_str(&right);
            Some(left)
        }
        (Some(left), None) => Some(left),
        (None, Some(right)) => Some(right),
        (None, None) => None,
    }
}

fn clip_text(raw: &str, max_bytes: usize) -> String {
    if raw.len() <= max_bytes {
        return raw.to_string();
    }
    let mut out = raw[..max_bytes].to_string();
    out.push_str("...");
    out
}

fn fmt_version(v: SimpleVersion) -> String {
    format!("{}.{}.{}", v.major, v.minor, v.patch)
}

fn parse_version_bound(kind: &str, raw: &str) -> Result<SimpleVersion, UpdatePrecheck> {
    parse_simple_version(raw).ok_or_else(|| {
        UpdatePrecheck::needs_manual(
            format!("{kind}_invalid"),
            format!(
                "compatibility {kind} `{raw}` is not a valid semantic version (expected x.y.z)"
            ),
        )
    })
}

fn evaluate_catalog_precheck(catalog: &UpdateCatalog) -> UpdatePrecheck {
    let current_control_raw = env!("CARGO_PKG_VERSION");
    let Some(current_control) = parse_simple_version(current_control_raw) else {
        return UpdatePrecheck::needs_manual(
            "control_version_invalid",
            format!(
                "control version `{current_control_raw}` is invalid; verify build metadata"
            ),
        );
    };

    let Some(latest_control) = parse_simple_version(&catalog.control.tag_name) else {
        return UpdatePrecheck::needs_manual(
            "control_release_version_invalid",
            format!(
                "catalog control tag `{}` is not parseable as x.y.z",
                catalog.control.tag_name
            ),
        );
    };

    if latest_control <= current_control {
        return UpdatePrecheck::not_updatable(
            "already_latest",
            format!(
                "current control {} is already on latest catalog release {}",
                fmt_version(current_control),
                fmt_version(latest_control)
            ),
        );
    }

    if catalog.source == UpdateSource::GithubReleaseLatest {
        return UpdatePrecheck::needs_manual(
            "compatibility_unknown",
            "catalog came from GitHub releases/latest without control-agent compatibility window"
                .to_string(),
        );
    }

    let Some(compat) = catalog.compatibility.as_ref() else {
        return UpdatePrecheck::needs_manual(
            "compatibility_missing",
            "manifest does not provide control-agent compatibility window".to_string(),
        );
    };

    let min = match compat.control_min_agent.as_deref() {
        Some(raw) => match parse_version_bound("control_min_agent", raw) {
            Ok(v) => Some(v),
            Err(precheck) => return precheck,
        },
        None => None,
    };

    let max = match compat.control_max_agent.as_deref() {
        Some(raw) => match parse_version_bound("control_max_agent", raw) {
            Ok(v) => Some(v),
            Err(precheck) => return precheck,
        },
        None => None,
    };

    if min.is_none() && max.is_none() {
        return UpdatePrecheck::needs_manual(
            "compatibility_window_empty",
            "manifest compatibility exists but both control_min_agent and control_max_agent are empty"
                .to_string(),
        );
    }

    if let (Some(min_v), Some(max_v)) = (min, max)
        && min_v > max_v
    {
        return UpdatePrecheck::needs_manual(
            "compatibility_window_invalid",
            format!(
                "manifest compatibility window is invalid: min {} > max {}",
                fmt_version(min_v),
                fmt_version(max_v)
            ),
        );
    }

    let Some(agent_release) = catalog.agent.as_ref() else {
        return UpdatePrecheck::needs_manual(
            "agent_release_missing",
            "manifest did not provide paired agent release for compatibility gate".to_string(),
        );
    };

    let Some(agent_version) = parse_simple_version(&agent_release.tag_name) else {
        return UpdatePrecheck::needs_manual(
            "agent_release_version_invalid",
            format!(
                "agent release tag `{}` is not parseable as x.y.z",
                agent_release.tag_name
            ),
        );
    };

    if min.map(|v| agent_version < v).unwrap_or(false)
        || max.map(|v| agent_version > v).unwrap_or(false)
    {
        let min_text = min
            .map(fmt_version)
            .unwrap_or_else(|| "-inf".to_string());
        let max_text = max
            .map(fmt_version)
            .unwrap_or_else(|| "+inf".to_string());
        return UpdatePrecheck::not_updatable(
            "incompatible_agent_version",
            format!(
                "agent release {} is outside compatibility window [{min_text}, {max_text}]",
                fmt_version(agent_version)
            ),
        );
    }

    UpdatePrecheck::updatable(
        "compatible",
        "control release is newer and paired agent release is inside compatibility window"
            .to_string(),
    )
}

fn precheck_warning(precheck: &UpdatePrecheck) -> Option<String> {
    if precheck.status == UpdatePrecheckStatus::Updatable || precheck.reason_code == "already_latest" {
        return None;
    }
    Some(format!(
        "update precheck={} reason={} detail={}",
        precheck.status.as_str(),
        precheck.reason_code,
        precheck.detail
    ))
}

fn finalize_catalog(mut catalog: UpdateCatalog) -> UpdateCatalog {
    let precheck = evaluate_catalog_precheck(&catalog);
    catalog.warning = merge_warning(catalog.warning.take(), precheck_warning(&precheck));
    catalog.precheck = precheck;
    catalog
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CatalogFetchPolicy {
    TtlCache,
    ForceRefresh,
}

impl CatalogFetchPolicy {
    fn as_str(self) -> &'static str {
        match self {
            Self::TtlCache => "ttl_cache",
            Self::ForceRefresh => "force_refresh",
        }
    }
}

fn cache() -> &'static Mutex<Option<CachedCatalog>> {
    static CACHE: OnceLock<Mutex<Option<CachedCatalog>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn fallback_catalog_without_cache(policy: CatalogFetchPolicy, err: &anyhow::Error) -> UpdateCatalog {
    let manifest_url = update_manifest_url();
    let source = if manifest_url.is_some() {
        UpdateSource::Manifest
    } else {
        UpdateSource::GithubReleaseLatest
    };

    let repo = github_repo();
    let fallback_release_url = manifest_url
        .clone()
        .unwrap_or_else(|| format!("https://github.com/{repo}/releases"));
    let detail = clip_text(&err.to_string(), 768);

    UpdateCatalog {
        control: LatestRelease {
            tag_name: format!("v{}", env!("CARGO_PKG_VERSION")),
            html_url: fallback_release_url,
            published_at: None,
            body: Some("degraded local fallback: upstream catalog unavailable".to_string()),
        },
        agent: None,
        source,
        channel: Some("degraded".to_string()),
        manifest_url,
        compatibility: None,
        precheck: UpdatePrecheck::needs_manual(
            "catalog_unavailable_offline",
            format!(
                "catalog {policy} failed with no cache; returned local fallback. error={detail}",
                policy = policy.as_str()
            ),
        ),
        warning: Some(format!(
            "catalog {policy} failed and no cache is available; returned degraded local fallback. error={detail}",
            policy = policy.as_str()
        )),
    }
}

pub async fn update_catalog() -> anyhow::Result<UpdateCatalog> {
    update_catalog_with_policy(CatalogFetchPolicy::TtlCache).await
}

pub async fn update_catalog_force() -> anyhow::Result<UpdateCatalog> {
    update_catalog_with_policy(CatalogFetchPolicy::ForceRefresh).await
}

async fn update_catalog_with_policy(policy: CatalogFetchPolicy) -> anyhow::Result<UpdateCatalog> {
    const TTL: Duration = Duration::from_secs(10 * 60);

    let cached = cache().lock().unwrap_or_else(|e| e.into_inner()).clone();
    if policy == CatalogFetchPolicy::TtlCache
        && let Some(hit) = cached
            .as_ref()
            .filter(|c| c.fetched_at.elapsed() < TTL)
            .map(|c| c.catalog.clone())
    {
        return Ok(hit);
    }

    match fetch_update_catalog().await {
        Ok(catalog) => {
            *cache().lock().unwrap_or_else(|e| e.into_inner()) = Some(CachedCatalog {
                fetched_at: Instant::now(),
                catalog: catalog.clone(),
            });
            Ok(catalog)
        }
        Err(err) => {
            if let Some(stale) = cached {
                let age_secs = stale.fetched_at.elapsed().as_secs();
                let mut degraded = stale.catalog.clone();
                degraded.warning = merge_warning(
                    degraded.warning.take(),
                    Some(format!(
                        "catalog {} failed, using stale cache (age={}s): {}",
                        policy.as_str(),
                        age_secs,
                        err
                    )),
                );
                degraded.precheck = evaluate_catalog_precheck(&degraded);
                return Ok(degraded);
            }

            Ok(fallback_catalog_without_cache(policy, &err))
        }
    }
}

pub async fn latest_release() -> anyhow::Result<LatestRelease> {
    Ok(update_catalog().await?.control)
}

async fn fetch_update_catalog() -> anyhow::Result<UpdateCatalog> {
    let manifest_url = update_manifest_url();
    let mut manifest_error: Option<String> = None;

    if let Some(url) = manifest_url.as_ref() {
        match fetch_update_catalog_from_manifest(url).await {
            Ok(catalog) => return Ok(finalize_catalog(catalog)),
            Err(err) => {
                manifest_error = Some(err.to_string());
            }
        }
    }

    let latest = fetch_latest_release_from_github().await?;
    Ok(finalize_catalog(UpdateCatalog {
        control: latest,
        agent: None,
        source: UpdateSource::GithubReleaseLatest,
        channel: None,
        manifest_url: manifest_url,
        compatibility: None,
        precheck: UpdatePrecheck::needs_manual("not_evaluated", "precheck not evaluated yet"),
        warning: manifest_error.map(|msg| {
            format!("update manifest unavailable, fell back to GitHub releases/latest: {msg}")
        }),
    }))
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
        precheck: UpdatePrecheck::needs_manual("not_evaluated", "precheck not evaluated yet"),
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
        anyhow::bail!(
            "ALLOY_UPDATE_WATCHTOWER_URL is not set; endpoint/token/status diagnostics unavailable until updater endpoint is configured"
        );
    }
    let token = std::env::var("ALLOY_UPDATE_WATCHTOWER_TOKEN")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let endpoint = format!("{}/v1/update", url.trim_end_matches('/'));
    let token_state = if token.is_some() { "present" } else { "missing" };

    let mut req = http_client().get(&endpoint);
    if let Some(token) = token {
        req = req.bearer_auth(token);
    }
    let resp = req.send().await.map_err(|err| {
        anyhow::anyhow!(
            "watchtower update request failed: endpoint={endpoint}, token={token_state}, status=unreachable, error={err}. hint: verify ALLOY_UPDATE_WATCHTOWER_URL, endpoint reachability, and watchtower http api settings"
        )
    })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let body = clip_text(text.trim(), 512);
        anyhow::bail!(
            "watchtower update failed: endpoint={endpoint}, token={token_state}, status={status}, body={body}. hint: verify WATCHTOWER_HTTP_API_TOKEN and /v1/update availability"
        );
    }

    Ok(text)
}
