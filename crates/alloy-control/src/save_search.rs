use reqwest::{StatusCode, Url};
use serde::{Deserialize, de::DeserializeOwned};
use std::{
    cmp::Reverse,
    collections::HashMap,
    future::Future,
    net::IpAddr,
    pin::Pin,
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

const MODRINTH_API_BASE: &str = "https://api.modrinth.com/v2";
const MODRINTH_WORLD_PAGE_BASE: &str = "https://modrinth.com/world";
const MODRINTH_ALLOWED_HOSTS: &[&str] = &["cdn.modrinth.com", "modrinth.com"];

const MODRINTH_PROVIDER_ID: ProviderId = "modrinth";

const SEARCH_CACHE_TTL: Duration = Duration::from_secs(45);
const SEARCH_CACHE_STALE_TTL: Duration = Duration::from_secs(10 * 60);
const SEARCH_CACHE_MAX_ENTRIES: usize = 256;
const RESOLVE_CACHE_TTL: Duration = Duration::from_secs(120);
const RESOLVE_CACHE_STALE_TTL: Duration = Duration::from_secs(30 * 60);
const RESOLVE_CACHE_MAX_ENTRIES: usize = 256;

const RETRY_ATTEMPTS: u32 = 3;
const RETRY_BASE_DELAY_MS: u64 = 220;
const RETRY_MAX_DELAY_MS: u64 = 1800;

const PROVIDER_BACKOFF_BASE_MS: u64 = 400;
const PROVIDER_BACKOFF_MAX_MS: u64 = 30_000;

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

type ProviderId = &'static str;
type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

trait SaveSearchProviderBackend: Send + Sync {
    fn id(&self) -> ProviderId;

    fn search_worlds<'a>(
        &'a self,
        query: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, anyhow::Result<Vec<SaveSearchHit>>>;

    fn resolve_download<'a>(
        &'a self,
        project_id: &'a str,
        version_id: &'a str,
    ) -> BoxFuture<'a, anyhow::Result<ResolvedSaveDownload>>;
}

struct ModrinthProvider;

impl SaveSearchProviderBackend for ModrinthProvider {
    fn id(&self) -> ProviderId {
        "modrinth"
    }

    fn search_worlds<'a>(
        &'a self,
        query: &'a str,
        limit: u32,
    ) -> BoxFuture<'a, anyhow::Result<Vec<SaveSearchHit>>> {
        Box::pin(async move { search_worlds_modrinth(query, limit).await })
    }

    fn resolve_download<'a>(
        &'a self,
        project_id: &'a str,
        version_id: &'a str,
    ) -> BoxFuture<'a, anyhow::Result<ResolvedSaveDownload>> {
        Box::pin(async move { resolve_download_modrinth(project_id, version_id).await })
    }
}

static MODRINTH_PROVIDER: ModrinthProvider = ModrinthProvider;
static PROVIDERS: [&'static dyn SaveSearchProviderBackend; 1] = [&MODRINTH_PROVIDER];

fn providers() -> &'static [&'static dyn SaveSearchProviderBackend] {
    &PROVIDERS
}

#[derive(Debug)]
struct SaveSearchError {
    scope: &'static str,
    provider: Option<ProviderId>,
    code: &'static str,
    retryable: bool,
    message: String,
}

impl std::fmt::Display for SaveSearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "save_search_error scope={} provider={} code={} retryable={} message={}",
            self.scope,
            self.provider.unwrap_or("-"),
            self.code,
            self.retryable,
            self.message
        )
    }
}

impl std::error::Error for SaveSearchError {}

fn structured_error(
    scope: &'static str,
    provider: Option<ProviderId>,
    code: &'static str,
    retryable: bool,
    message: impl Into<String>,
) -> anyhow::Error {
    anyhow::Error::new(SaveSearchError {
        scope,
        provider,
        code,
        retryable,
        message: message.into(),
    })
}

fn is_retryable_provider_error(err: &anyhow::Error) -> bool {
    err.downcast_ref::<SaveSearchError>()
        .map(|v| v.retryable && v.provider.is_some())
        .unwrap_or(false)
}

fn provider_from_input(raw: &str) -> anyhow::Result<&'static dyn SaveSearchProviderBackend> {
    let normalized = raw.trim().to_ascii_lowercase();
    if normalized.is_empty() {
        return Err(structured_error(
            "input",
            None,
            "provider_required",
            false,
            "provider is required",
        ));
    }

    providers()
        .iter()
        .copied()
        .find(|p| p.id() == normalized.as_str())
        .ok_or_else(|| {
            structured_error(
                "input",
                None,
                "unsupported_provider",
                false,
                format!("unsupported provider: {raw}"),
            )
        })
}

fn is_provider_scoped_error(err: &anyhow::Error) -> bool {
    err.downcast_ref::<SaveSearchError>()
        .is_some_and(|v| v.provider.is_some())
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct SearchCacheKey {
    provider: ProviderId,
    query: String,
    limit: u32,
}

#[derive(Debug, Clone)]
struct SearchCacheEntry {
    cached_at: Instant,
    value: Vec<SaveSearchHit>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct ResolveCacheKey {
    provider: ProviderId,
    project_id: String,
    version_id: String,
}

#[derive(Debug, Clone)]
struct ResolveCacheEntry {
    cached_at: Instant,
    value: ResolvedSaveDownload,
}

#[derive(Debug, Clone, Default)]
struct ProviderRuntimeState {
    consecutive_retryable_failures: u32,
    blocked_until: Option<Instant>,
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

fn search_cache() -> &'static Mutex<HashMap<SearchCacheKey, SearchCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<SearchCacheKey, SearchCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn resolve_cache() -> &'static Mutex<HashMap<ResolveCacheKey, ResolveCacheEntry>> {
    static CACHE: OnceLock<Mutex<HashMap<ResolveCacheKey, ResolveCacheEntry>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn provider_state() -> &'static Mutex<HashMap<ProviderId, ProviderRuntimeState>> {
    static STATE: OnceLock<Mutex<HashMap<ProviderId, ProviderRuntimeState>>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clamp_limit(limit: Option<u32>) -> u32 {
    let raw = limit.unwrap_or(10);
    raw.clamp(1, 20)
}

fn trim_non_empty(raw: Option<String>) -> Option<String> {
    raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn normalize_query_for_cache(raw: &str) -> String {
    raw.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

fn retry_delay(attempt: u32) -> Duration {
    let step = 1_u64 << attempt.saturating_sub(1).min(4);
    Duration::from_millis((RETRY_BASE_DELAY_MS.saturating_mul(step)).min(RETRY_MAX_DELAY_MS))
}

fn provider_failure_backoff(failures: u32) -> Duration {
    let step = 1_u64 << failures.saturating_sub(1).min(6);
    Duration::from_millis(
        (PROVIDER_BACKOFF_BASE_MS.saturating_mul(step)).min(PROVIDER_BACKOFF_MAX_MS),
    )
}

fn ensure_provider_ready(provider: ProviderId) -> anyhow::Result<()> {
    let now = Instant::now();
    let guard = provider_state().lock().unwrap_or_else(|e| e.into_inner());
    if let Some(state) = guard.get(&provider)
        && let Some(until) = state.blocked_until
        && until > now
    {
        let wait_ms = until.duration_since(now).as_millis();
        return Err(structured_error(
            "provider",
            Some(provider),
            "provider_backoff_active",
            true,
            format!("provider is in backoff window; retry in {wait_ms}ms"),
        ));
    }
    Ok(())
}

fn mark_provider_success(provider: ProviderId) {
    let mut guard = provider_state().lock().unwrap_or_else(|e| e.into_inner());
    guard.insert(
        provider,
        ProviderRuntimeState {
            consecutive_retryable_failures: 0,
            blocked_until: None,
        },
    );
}

fn mark_provider_retryable_failure(provider: ProviderId) -> Duration {
    let now = Instant::now();
    let mut guard = provider_state().lock().unwrap_or_else(|e| e.into_inner());
    let state = guard.entry(provider).or_default();
    state.consecutive_retryable_failures = state.consecutive_retryable_failures.saturating_add(1);
    let delay = provider_failure_backoff(state.consecutive_retryable_failures);
    state.blocked_until = Some(now + delay);
    delay
}

fn prune_search_cache(cache: &mut HashMap<SearchCacheKey, SearchCacheEntry>, now: Instant) {
    cache.retain(|_, v| now.duration_since(v.cached_at) < SEARCH_CACHE_STALE_TTL);
    if cache.len() <= SEARCH_CACHE_MAX_ENTRIES {
        return;
    }
    if let Some(oldest_key) = cache
        .iter()
        .min_by_key(|(_, v)| v.cached_at)
        .map(|(k, _)| k.clone())
    {
        cache.remove(&oldest_key);
    }
}

fn prune_resolve_cache(cache: &mut HashMap<ResolveCacheKey, ResolveCacheEntry>, now: Instant) {
    cache.retain(|_, v| now.duration_since(v.cached_at) < RESOLVE_CACHE_STALE_TTL);
    if cache.len() <= RESOLVE_CACHE_MAX_ENTRIES {
        return;
    }
    if let Some(oldest_key) = cache
        .iter()
        .min_by_key(|(_, v)| v.cached_at)
        .map(|(k, _)| k.clone())
    {
        cache.remove(&oldest_key);
    }
}

fn get_search_cache_fresh(key: &SearchCacheKey) -> Option<Vec<SaveSearchHit>> {
    let now = Instant::now();
    let mut guard = search_cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_search_cache(&mut guard, now);
    guard.get(key).and_then(|entry| {
        if now.duration_since(entry.cached_at) < SEARCH_CACHE_TTL {
            Some(entry.value.clone())
        } else {
            None
        }
    })
}

fn get_search_cache_stale(key: &SearchCacheKey) -> Option<Vec<SaveSearchHit>> {
    let now = Instant::now();
    let mut guard = search_cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_search_cache(&mut guard, now);
    guard.get(key).and_then(|entry| {
        if now.duration_since(entry.cached_at) < SEARCH_CACHE_STALE_TTL {
            Some(entry.value.clone())
        } else {
            None
        }
    })
}

fn put_search_cache(key: SearchCacheKey, value: Vec<SaveSearchHit>) {
    let now = Instant::now();
    let mut guard = search_cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_search_cache(&mut guard, now);
    guard.insert(
        key,
        SearchCacheEntry {
            cached_at: now,
            value,
        },
    );
}

fn get_resolve_cache_fresh(key: &ResolveCacheKey) -> Option<ResolvedSaveDownload> {
    let now = Instant::now();
    let mut guard = resolve_cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_resolve_cache(&mut guard, now);
    guard.get(key).and_then(|entry| {
        if now.duration_since(entry.cached_at) < RESOLVE_CACHE_TTL {
            Some(entry.value.clone())
        } else {
            None
        }
    })
}

fn get_resolve_cache_stale(key: &ResolveCacheKey) -> Option<ResolvedSaveDownload> {
    let now = Instant::now();
    let mut guard = resolve_cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_resolve_cache(&mut guard, now);
    guard.get(key).and_then(|entry| {
        if now.duration_since(entry.cached_at) < RESOLVE_CACHE_STALE_TTL {
            Some(entry.value.clone())
        } else {
            None
        }
    })
}

fn put_resolve_cache(key: ResolveCacheKey, value: ResolvedSaveDownload) {
    let now = Instant::now();
    let mut guard = resolve_cache().lock().unwrap_or_else(|e| e.into_inner());
    prune_resolve_cache(&mut guard, now);
    guard.insert(
        key,
        ResolveCacheEntry {
            cached_at: now,
            value,
        },
    );
}

fn host_allowed(host: &str, allowlist: &[&str]) -> bool {
    allowlist
        .iter()
        .any(|allowed| host == *allowed || host.strip_suffix(&format!(".{allowed}")).is_some())
}

fn validate_allowed_https_url(
    provider: ProviderId,
    raw: &str,
    allowed_hosts: &[&str],
) -> anyhow::Result<Url> {
    let parsed = Url::parse(raw.trim()).map_err(|e| {
        structured_error(
            "validation",
            Some(provider),
            "invalid_url",
            false,
            format!("invalid provider url: {e}"),
        )
    })?;

    if parsed.scheme() != "https" {
        return Err(structured_error(
            "validation",
            Some(provider),
            "url_scheme_not_allowed",
            false,
            "provider url must use https",
        ));
    }

    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err(structured_error(
            "validation",
            Some(provider),
            "url_userinfo_not_allowed",
            false,
            "provider url must not include username/password",
        ));
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| {
            structured_error(
                "validation",
                Some(provider),
                "url_host_missing",
                false,
                "provider url host is missing",
            )
        })?
        .trim_end_matches('.')
        .to_ascii_lowercase();

    if host.parse::<IpAddr>().is_ok() {
        return Err(structured_error(
            "validation",
            Some(provider),
            "url_ip_not_allowed",
            false,
            "provider url host cannot be an IP address",
        ));
    }

    if parsed.port().is_some_and(|p| p != 443) {
        return Err(structured_error(
            "validation",
            Some(provider),
            "url_port_not_allowed",
            false,
            "provider url port is not allowed",
        ));
    }

    if !host_allowed(&host, allowed_hosts) {
        return Err(structured_error(
            "validation",
            Some(provider),
            "url_host_not_allowed",
            false,
            format!("provider url host is not allowed: {host}"),
        ));
    }

    Ok(parsed)
}

fn build_modrinth_world_page_url(project_or_slug: &str) -> String {
    let mut page = Url::parse(MODRINTH_WORLD_PAGE_BASE).expect("MODRINTH_WORLD_PAGE_BASE valid");
    if let Ok(mut segments) = page.path_segments_mut() {
        segments.push(project_or_slug.trim());
    }
    page.to_string()
}

fn sort_hits_stably(hits: &mut [SaveSearchHit]) {
    hits.sort_by_cached_key(|v| {
        (
            Reverse(v.downloads.unwrap_or(0)),
            v.title.trim().to_ascii_lowercase(),
            v.author.trim().to_ascii_lowercase(),
            v.project_id.trim().to_ascii_lowercase(),
            v.version_id.trim().to_ascii_lowercase(),
        )
    });
}

async fn fetch_json_with_retry<T>(
    provider: ProviderId,
    url: Url,
    operation: &'static str,
) -> anyhow::Result<T>
where
    T: DeserializeOwned,
{
    let mut last_retryable_error: Option<anyhow::Error> = None;

    for attempt in 1..=RETRY_ATTEMPTS {
        let response = match http_client().get(url.clone()).send().await {
            Ok(v) => v,
            Err(err) => {
                let mapped = structured_error(
                    "provider",
                    Some(provider),
                    "request_send_failed",
                    true,
                    format!(
                        "{operation} request failed (attempt {attempt}/{RETRY_ATTEMPTS}): {err}"
                    ),
                );
                if attempt < RETRY_ATTEMPTS {
                    last_retryable_error = Some(mapped);
                    tokio::time::sleep(retry_delay(attempt)).await;
                    continue;
                }
                return Err(mapped);
            }
        };

        let status = response.status();
        if !status.is_success() {
            let retryable = status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error();
            let mapped = structured_error(
                "provider",
                Some(provider),
                if retryable {
                    "request_http_status_retryable"
                } else {
                    "request_http_status"
                },
                retryable,
                format!(
                    "{operation} returned status {} (attempt {attempt}/{RETRY_ATTEMPTS})",
                    status.as_u16()
                ),
            );
            if retryable && attempt < RETRY_ATTEMPTS {
                last_retryable_error = Some(mapped);
                tokio::time::sleep(retry_delay(attempt)).await;
                continue;
            }
            return Err(mapped);
        }

        return response.json::<T>().await.map_err(|err| {
            structured_error(
                "provider",
                Some(provider),
                "response_json_invalid",
                false,
                format!("{operation} response JSON parse failed: {err}"),
            )
        });
    }

    Err(last_retryable_error.unwrap_or_else(|| {
        structured_error(
            "provider",
            Some(provider),
            "request_retry_exhausted",
            true,
            format!("{operation} exhausted retry attempts"),
        )
    }))
}

async fn search_worlds_cached(
    provider: &'static dyn SaveSearchProviderBackend,
    query: &str,
    limit: u32,
) -> anyhow::Result<Vec<SaveSearchHit>> {
    let cache_key = SearchCacheKey {
        provider: provider.id(),
        query: normalize_query_for_cache(query),
        limit,
    };
    if let Some(cached) = get_search_cache_fresh(&cache_key) {
        return Ok(cached);
    }

    if let Err(err) = ensure_provider_ready(provider.id()) {
        if let Some(stale) = get_search_cache_stale(&cache_key) {
            return Ok(stale);
        }
        return Err(err);
    }

    match provider.search_worlds(query, limit).await {
        Ok(mut out) => {
            for hit in &mut out {
                hit.provider = provider.id().to_string();
            }
            sort_hits_stably(&mut out);
            put_search_cache(cache_key, out.clone());
            mark_provider_success(provider.id());
            Ok(out)
        }
        Err(err) => {
            if is_retryable_provider_error(&err) {
                let delay = mark_provider_retryable_failure(provider.id());
                if let Some(stale) = get_search_cache_stale(&cache_key) {
                    return Ok(stale);
                }
                return Err(structured_error(
                    "provider",
                    Some(provider.id()),
                    "provider_backoff_applied",
                    true,
                    format!(
                        "provider request failed; applied backoff={}ms; cause={err}",
                        delay.as_millis()
                    ),
                ));
            }

            if is_provider_scoped_error(&err)
                && let Some(stale) = get_search_cache_stale(&cache_key)
            {
                return Ok(stale);
            }

            Err(err)
        }
    }
}

async fn resolve_download_cached(
    provider: &'static dyn SaveSearchProviderBackend,
    project_id: &str,
    version_id: &str,
) -> anyhow::Result<ResolvedSaveDownload> {
    let cache_key = ResolveCacheKey {
        provider: provider.id(),
        project_id: project_id.to_string(),
        version_id: version_id.to_string(),
    };
    if let Some(cached) = get_resolve_cache_fresh(&cache_key) {
        return Ok(cached);
    }

    if let Err(err) = ensure_provider_ready(provider.id()) {
        if let Some(stale) = get_resolve_cache_stale(&cache_key) {
            return Ok(stale);
        }
        return Err(err);
    }

    match provider.resolve_download(project_id, version_id).await {
        Ok(mut resolved) => {
            resolved.provider = provider.id().to_string();
            put_resolve_cache(cache_key, resolved.clone());
            mark_provider_success(provider.id());
            Ok(resolved)
        }
        Err(err) => {
            if is_retryable_provider_error(&err) {
                let delay = mark_provider_retryable_failure(provider.id());
                if let Some(stale) = get_resolve_cache_stale(&cache_key) {
                    return Ok(stale);
                }
                return Err(structured_error(
                    "provider",
                    Some(provider.id()),
                    "provider_backoff_applied",
                    true,
                    format!(
                        "provider request failed; applied backoff={}ms; cause={err}",
                        delay.as_millis()
                    ),
                ));
            }

            if is_provider_scoped_error(&err)
                && let Some(stale) = get_resolve_cache_stale(&cache_key)
            {
                return Ok(stale);
            }

            Err(err)
        }
    }
}

async fn search_worlds_modrinth(query: &str, limit: u32) -> anyhow::Result<Vec<SaveSearchHit>> {
    let mut url =
        Url::parse(&format!("{MODRINTH_API_BASE}/search")).expect("MODRINTH_API_BASE valid");
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("index", "relevance")
        .append_pair("limit", &limit.to_string())
        .append_pair("facets", r#"[["project_type:world"]]"#);

    let resp: ModrinthSearchResponse =
        fetch_json_with_retry(MODRINTH_PROVIDER_ID, url, "modrinth_search").await?;

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
        let page_url = build_modrinth_world_page_url(&slug_or_id);

        out.push(SaveSearchHit {
            provider: MODRINTH_PROVIDER_ID.to_string(),
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

async fn resolve_download_modrinth(
    project_id: &str,
    version_id: &str,
) -> anyhow::Result<ResolvedSaveDownload> {
    let url = Url::parse(&format!("{MODRINTH_API_BASE}/version/{version_id}"))
        .expect("MODRINTH_API_BASE valid");
    let version: ModrinthVersionResponse =
        fetch_json_with_retry(MODRINTH_PROVIDER_ID, url, "modrinth_get_version").await?;

    if version.project_id.trim() != project_id {
        return Err(structured_error(
            "provider",
            Some(MODRINTH_PROVIDER_ID),
            "version_project_mismatch",
            false,
            "version does not belong to the selected project",
        ));
    }
    if version.id.trim() != version_id {
        return Err(structured_error(
            "provider",
            Some(MODRINTH_PROVIDER_ID),
            "version_id_mismatch",
            false,
            "version mismatch",
        ));
    }

    let file = version
        .files
        .iter()
        .find(|f| f.primary.unwrap_or(false))
        .or_else(|| version.files.first())
        .ok_or_else(|| {
            structured_error(
                "provider",
                Some(MODRINTH_PROVIDER_ID),
                "version_file_missing",
                false,
                "modrinth version has no downloadable files",
            )
        })?
        .clone();

    let parsed = validate_allowed_https_url(
        MODRINTH_PROVIDER_ID,
        file.url.trim(),
        MODRINTH_ALLOWED_HOSTS,
    )?;

    let label = trim_non_empty(version.name)
        .or_else(|| trim_non_empty(version.version_number))
        .unwrap_or_else(|| "modrinth world".to_string());

    Ok(ResolvedSaveDownload {
        provider: MODRINTH_PROVIDER_ID.to_string(),
        project_id: project_id.to_string(),
        version_id: version_id.to_string(),
        title: label,
        page_url: build_modrinth_world_page_url(project_id),
        download_url: parsed.to_string(),
    })
}

pub async fn search_minecraft_worlds(
    query: &str,
    limit: Option<u32>,
) -> anyhow::Result<Vec<SaveSearchHit>> {
    let q = query.trim();
    if q.is_empty() {
        return Err(structured_error(
            "input",
            None,
            "query_required",
            false,
            "query is required",
        ));
    }

    let limit = clamp_limit(limit);

    let mut out = Vec::<SaveSearchHit>::new();
    let mut errors = Vec::<anyhow::Error>::new();
    let mut had_any_success = false;

    for provider in providers() {
        match search_worlds_cached(*provider, q, limit).await {
            Ok(mut hits) => {
                had_any_success = true;
                out.append(&mut hits);
            }
            Err(err) => errors.push(err),
        }
    }

    if out.is_empty() {
        if had_any_success {
            return Ok(Vec::new());
        }
        if errors.is_empty() {
            return Err(structured_error(
                "internal",
                None,
                "no_providers_configured",
                false,
                "no save search providers configured",
            ));
        }

        let message = errors
            .iter()
            .enumerate()
            .map(|(idx, err)| format!("{}:{err}", idx + 1))
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(structured_error(
            "provider",
            None,
            "all_providers_failed",
            true,
            format!("all save search providers failed: {message}"),
        ));
    }

    sort_hits_stably(&mut out);
    out.truncate(limit as usize);
    Ok(out)
}

pub async fn resolve_save_download(
    input: ResolveSaveDownloadInput,
) -> anyhow::Result<ResolvedSaveDownload> {
    let provider = provider_from_input(&input.provider)?;

    let project_id = input.project_id.trim();
    if project_id.is_empty() {
        return Err(structured_error(
            "input",
            None,
            "project_id_required",
            false,
            "project_id is required",
        ));
    }
    let version_id = input.version_id.trim();
    if version_id.is_empty() {
        return Err(structured_error(
            "input",
            None,
            "version_id_required",
            false,
            "version_id is required",
        ));
    }

    resolve_download_cached(provider, project_id, version_id).await
}
