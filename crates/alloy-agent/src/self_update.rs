use std::{sync::OnceLock, time::Duration};

use anyhow::Context;
use alloy_proto::agent_v1::agent_update_service_server::{
    AgentUpdateService, AgentUpdateServiceServer,
};
use alloy_proto::agent_v1::{
    GetSelfUpdateStatusRequest, GetSelfUpdateStatusResponse, TriggerSelfUpdateRequest,
    TriggerSelfUpdateResponse,
};
use tonic::{Request, Response, Status};

const DEFAULT_WATCHTOWER_URL: &str = "http://watchtower:8080";
const DEFAULT_UPDATE_MANIFEST_URL: &str =
    "https://github.com/Ign1x/Alloy/releases/latest/download/update-manifest.json";
const DEFAULT_UPDATE_GITHUB_REPO: &str = "Ign1x/Alloy";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct SimpleVersion {
    major: u64,
    minor: u64,
    patch: u64,
}

fn parse_simple_version(raw: &str) -> Option<SimpleVersion> {
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

fn parse_version_bound(
    kind: &str,
    raw: &str,
    allow_wildcard_patch: bool,
) -> Result<SimpleVersion, String> {
    let s = raw.trim().trim_start_matches('v');
    let mut it = s.split(|c: char| matches!(c, '.' | '-' | '+'));
    let major_raw = it.next().unwrap_or_default();
    let minor_raw = it.next().unwrap_or_default();
    let patch_raw = it.next();

    let expected = if allow_wildcard_patch {
        "x.y.z or x.y.x"
    } else {
        "x.y.z"
    };

    let major: u64 = major_raw
        .parse()
        .map_err(|_| format!("compatibility {kind} `{raw}` is not a valid version (expected {expected})"))?;
    let minor: u64 = minor_raw
        .parse()
        .map_err(|_| format!("compatibility {kind} `{raw}` is not a valid version (expected {expected})"))?;

    let patch: u64 = match patch_raw.map(|v| v.trim()) {
        Some(p)
            if allow_wildcard_patch && matches!(p.to_ascii_lowercase().as_str(), "x" | "*") =>
        {
            u64::MAX
        }
        Some(p) => p
            .parse()
            .map_err(|_| format!("compatibility {kind} `{raw}` is not a valid version (expected {expected})"))?,
        None if allow_wildcard_patch => u64::MAX,
        None => {
            return Err(format!(
                "compatibility {kind} `{raw}` is not a valid version (expected {expected})"
            ));
        }
    };

    Ok(SimpleVersion {
        major,
        minor,
        patch,
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CompatibilityGateStatus {
    Updatable,
    NotUpdatable,
    NeedsManualConfirmation,
}

impl CompatibilityGateStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Updatable => "updatable",
            Self::NotUpdatable => "not_updatable",
            Self::NeedsManualConfirmation => "needs_manual_confirmation",
        }
    }
}

#[derive(Debug, Clone)]
struct CompatibilityGateDecision {
    status: CompatibilityGateStatus,
    reason_code: String,
    detail: String,
    hint: Option<String>,
}

impl CompatibilityGateDecision {
    fn updatable(reason_code: impl Into<String>, detail: impl Into<String>) -> Self {
        Self {
            status: CompatibilityGateStatus::Updatable,
            reason_code: reason_code.into(),
            detail: detail.into(),
            hint: None,
        }
    }

    fn not_updatable(
        reason_code: impl Into<String>,
        detail: impl Into<String>,
        hint: Option<String>,
    ) -> Self {
        Self {
            status: CompatibilityGateStatus::NotUpdatable,
            reason_code: reason_code.into(),
            detail: detail.into(),
            hint,
        }
    }

    fn needs_manual(
        reason_code: impl Into<String>,
        detail: impl Into<String>,
        hint: Option<String>,
    ) -> Self {
        Self {
            status: CompatibilityGateStatus::NeedsManualConfirmation,
            reason_code: reason_code.into(),
            detail: detail.into(),
            hint,
        }
    }

    fn into_error_payload(self) -> (String, String, Option<String>) {
        let code = self.status.as_str().to_string();
        let msg = format!(
            "compatibility_gate={} reason={} detail={}",
            self.status.as_str(),
            self.reason_code,
            self.detail
        );
        (code, msg, self.hint)
    }
}

#[derive(Debug, serde::Deserialize)]
struct UpdateManifest {
    #[serde(default)]
    schema: Option<u32>,
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
}

#[derive(Debug, serde::Deserialize)]
struct ManifestCompatibilityRaw {
    #[serde(default)]
    control_min_agent: Option<String>,
    #[serde(default)]
    control_max_agent: Option<String>,
}

fn trim_non_empty(raw: Option<String>) -> Option<String> {
    raw.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

fn github_repo() -> String {
    std::env::var("ALLOY_UPDATE_GITHUB_REPO")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATE_GITHUB_REPO.to_string())
}

fn update_manifest_url_latest() -> String {
    std::env::var("ALLOY_UPDATE_MANIFEST_URL")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| DEFAULT_UPDATE_MANIFEST_URL.to_string())
}

fn manifest_release_version(rel: &ManifestRelease) -> Option<String> {
    trim_non_empty(rel.version.clone()).or_else(|| {
        trim_non_empty(rel.tag.clone()).map(|t| t.trim_start_matches('v').to_string())
    })
}

async fn fetch_update_manifest(url: &str) -> anyhow::Result<UpdateManifest> {
    let resp = http_client()
        .get(url)
        .header("accept", "application/json")
        .send()
        .await
        .with_context(|| format!("request update manifest: {url}"))?
        .error_for_status()
        .with_context(|| format!("update manifest returned non-2xx: {url}"))?;

    let manifest = resp
        .json::<UpdateManifest>()
        .await
        .with_context(|| format!("parse update manifest JSON: {url}"))?;

    if let Some(schema) = manifest.schema
        && schema != 1
    {
        anyhow::bail!("unsupported update manifest schema {schema} (expected 1)");
    }

    Ok(manifest)
}

fn parse_any_urls(raw: &str) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for part in raw.split(|c: char| c == ',' || c == ';' || c.is_whitespace()) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|v| v == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
    }
    out
}

fn control_ping_urls() -> Vec<String> {
    let urls = std::env::var("ALLOY_CONTROL_WS_URLS")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .map(|v| parse_any_urls(&v))
        .filter(|v| !v.is_empty())
        .or_else(|| {
            std::env::var("ALLOY_CONTROL_WS_URL")
                .ok()
                .map(|v| parse_any_urls(&v))
                .filter(|v| !v.is_empty())
        })
        .unwrap_or_default();

    let mut out = Vec::<String>::new();
    for raw in urls {
        let Ok(mut url) = reqwest::Url::parse(&raw) else {
            continue;
        };

        let scheme = match url.scheme() {
            "ws" => "http",
            "wss" => "https",
            "http" => "http",
            "https" => "https",
            _ => continue,
        };
        let _ = url.set_scheme(scheme);
        url.set_fragment(None);
        url.set_path("/rspc/control.ping");
        url.set_query(Some("input=null"));
        out.push(url.to_string());
    }
    out
}

fn parse_control_ping_version(raw: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let version = v
        .get("result")
        .and_then(|r| r.get("data"))
        .and_then(|d| d.get("version"))
        .and_then(|s| s.as_str())
        .map(|s| s.trim())?;
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

async fn fetch_control_version() -> anyhow::Result<String> {
    let urls = control_ping_urls();
    if urls.is_empty() {
        anyhow::bail!("control ping URL is not configured (missing ALLOY_CONTROL_WS_URL)");
    }

    let mut last_err: Option<anyhow::Error> = None;
    for url in urls {
        let resp = http_client().get(&url).send().await;
        let resp = match resp {
            Ok(v) => v,
            Err(e) => {
                last_err = Some(anyhow::anyhow!(e).context(format!("request control ping: {url}")));
                continue;
            }
        };
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            last_err = Some(anyhow::anyhow!(
                "control ping returned non-2xx: url={url} status={status} body={}",
                clip_text(text.trim(), 512)
            ));
            continue;
        }

        if let Some(version) = parse_control_ping_version(&text) {
            return Ok(version);
        }

        last_err = Some(anyhow::anyhow!(
            "control ping returned unexpected payload: url={url} body={}",
            clip_text(text.trim(), 512)
        ));
    }

    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("control ping failed")))
}

async fn evaluate_self_update_compatibility_gate() -> CompatibilityGateDecision {
    let control_version = match fetch_control_version().await {
        Ok(v) => v,
        Err(e) => {
            return CompatibilityGateDecision::needs_manual(
                "control_version_unavailable",
                format!("failed to determine control version: {e}"),
                Some(
                    "Ensure alloy-agent can reach control and /rspc/control.ping is reachable from this node."
                        .to_string(),
                ),
            );
        }
    };

    let latest_manifest_url = update_manifest_url_latest();
    let latest_manifest = match fetch_update_manifest(&latest_manifest_url).await {
        Ok(v) => v,
        Err(e) => {
            return CompatibilityGateDecision::needs_manual(
                "latest_manifest_unavailable",
                format!("failed to fetch latest update manifest: {e}"),
                Some(
                    "Verify outbound HTTPS connectivity or set ALLOY_UPDATE_MANIFEST_URL to a reachable update-manifest.json."
                        .to_string(),
                ),
            );
        }
    };

    let Some(target_agent_rel) = latest_manifest.agent.as_ref() else {
        return CompatibilityGateDecision::needs_manual(
            "agent_release_missing",
            "latest update manifest is missing agent release entry".to_string(),
            Some(
                "Ensure update-manifest.json includes an `agent` section with version/tag."
                    .to_string(),
            ),
        );
    };

    let Some(target_agent_raw) = manifest_release_version(target_agent_rel) else {
        return CompatibilityGateDecision::needs_manual(
            "agent_release_version_missing",
            "latest update manifest agent entry is missing tag/version".to_string(),
            Some(
                "Ensure update-manifest.json `agent` includes `version` (x.y.z) or `tag` (vX.Y.Z)."
                    .to_string(),
            ),
        );
    };

    let Some(target_agent) = parse_simple_version(&target_agent_raw) else {
        return CompatibilityGateDecision::needs_manual(
            "agent_release_version_invalid",
            format!("target agent version `{target_agent_raw}` is not parseable as x.y.z"),
            Some(
                "Fix the update-manifest.json agent version/tag so it is a valid semantic version."
                    .to_string(),
            ),
        );
    };

    let repo = github_repo();
    let control_tag = format!("v{}", control_version.trim().trim_start_matches('v'));
    let control_manifest_url =
        format!("https://github.com/{repo}/releases/download/{control_tag}/update-manifest.json");
    let control_manifest = match fetch_update_manifest(&control_manifest_url).await {
        Ok(v) => v,
        Err(e) => {
            return CompatibilityGateDecision::needs_manual(
                "control_manifest_unavailable",
                format!(
                    "failed to fetch compatibility window for control {control_version}: {e}"
                ),
                Some(
                    "If control is not a tagged release, update control first or pin agent updates manually to a known compatible version."
                        .to_string(),
                ),
            );
        }
    };

    let Some(compat) = control_manifest.compatibility else {
        return CompatibilityGateDecision::needs_manual(
            "compatibility_missing",
            format!("control {control_version} manifest has no compatibility window"),
            Some(
                "Ensure the control release ships update-manifest.json with `compatibility.control_min_agent` / `control_max_agent`."
                    .to_string(),
            ),
        );
    };

    let min_raw = trim_non_empty(compat.control_min_agent);
    let max_raw = trim_non_empty(compat.control_max_agent);
    if min_raw.is_none() && max_raw.is_none() {
        return CompatibilityGateDecision::needs_manual(
            "compatibility_window_empty",
            format!("control {control_version} compatibility window is empty"),
            Some(
                "Fix the manifest compatibility window (set control_min_agent/control_max_agent), or update control to a release that includes it."
                    .to_string(),
            ),
        );
    }

    let min = match min_raw.as_deref() {
        Some(raw) => match parse_version_bound("control_min_agent", raw, false) {
            Ok(v) => Some(v),
            Err(detail) => {
                return CompatibilityGateDecision::needs_manual(
                    "compatibility_invalid",
                    detail,
                    Some(
                        "Fix the manifest compatibility control_min_agent to be a valid x.y.z."
                            .to_string(),
                    ),
                );
            }
        },
        None => None,
    };
    let max = match max_raw.as_deref() {
        Some(raw) => match parse_version_bound("control_max_agent", raw, true) {
            Ok(v) => Some(v),
            Err(detail) => {
                return CompatibilityGateDecision::needs_manual(
                    "compatibility_invalid",
                    detail,
                    Some(
                        "Fix the manifest compatibility control_max_agent to be a valid x.y.z (or x.y.x)."
                            .to_string(),
                    ),
                );
            }
        },
        None => None,
    };
    if let (Some(min_v), Some(max_v)) = (min, max)
        && min_v > max_v
    {
        return CompatibilityGateDecision::needs_manual(
            "compatibility_window_invalid",
            format!(
                "manifest compatibility window is invalid: min {} > max {}",
                min_raw.as_deref().unwrap_or(""),
                max_raw.as_deref().unwrap_or("")
            ),
            Some(
                "Fix the manifest compatibility window so control_min_agent <= control_max_agent."
                    .to_string(),
            ),
        );
    }

    if min.map(|v| target_agent < v).unwrap_or(false)
        || max.map(|v| target_agent > v).unwrap_or(false)
    {
        let min_text = min_raw.as_deref().unwrap_or("-inf");
        let max_text = max_raw.as_deref().unwrap_or("+inf");
        return CompatibilityGateDecision::not_updatable(
            "incompatible_agent_version",
            format!(
                "target agent {target_agent_raw} is outside compatibility window [{min_text}, {max_text}] for control {control_version}"
            ),
            Some(
                "Update control first (so the compatibility window allows the target agent), or pin the node's alloy-agent image tag to a compatible version."
                    .to_string(),
            ),
        );
    }

    CompatibilityGateDecision::updatable(
        "compatible",
        format!(
            "target agent {target_agent_raw} is compatible with control {control_version}"
        ),
    )
}

#[derive(Debug, Clone)]
struct SelfUpdateStatus {
    configured: bool,
    provider: String,
    endpoint: String,
    token: Option<String>,
}

fn env_non_empty(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        std::env::var(key)
            .ok()
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
    })
}

fn env_bool(name: &str, default: bool) -> bool {
    let Some(raw) = std::env::var(name).ok() else {
        return default;
    };
    match raw.trim().to_ascii_lowercase().as_str() {
        "0" | "false" | "no" | "off" => false,
        "1" | "true" | "yes" | "on" => true,
        _ => default,
    }
}

fn self_update_status() -> SelfUpdateStatus {
    let enabled = env_bool("ALLOY_AGENT_SELF_UPDATE_ENABLED", true);
    if !enabled {
        return SelfUpdateStatus {
            configured: false,
            provider: "watchtower".to_string(),
            endpoint: String::new(),
            token: None,
        };
    }

    let endpoint = env_non_empty(&[
        "ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_URL",
        "ALLOY_UPDATE_WATCHTOWER_URL",
    ])
    .unwrap_or_else(|| DEFAULT_WATCHTOWER_URL.to_string());

    let token = env_non_empty(&[
        "ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_TOKEN",
        "ALLOY_UPDATE_WATCHTOWER_TOKEN",
    ]);

    SelfUpdateStatus {
        configured: token.is_some(),
        provider: "watchtower".to_string(),
        endpoint,
        token,
    }
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("alloy-agent")
            .timeout(Duration::from_secs(30))
            .build()
            .expect("failed to build reqwest client")
    })
}

fn clip_text(raw: &str, max_bytes: usize) -> String {
    if raw.len() <= max_bytes {
        return raw.to_string();
    }
    let mut out = raw[..max_bytes].to_string();
    out.push_str("...");
    out
}

async fn trigger_watchtower_update(endpoint: &str, token: &str) -> anyhow::Result<String> {
    let url = format!("{}/v1/update", endpoint.trim_end_matches('/'));
    let token_state = if token.trim().is_empty() {
        "missing"
    } else {
        "present"
    };

    let resp = http_client()
        .get(&url)
        .bearer_auth(token)
        .send()
        .await
        .map_err(|err| {
            anyhow::anyhow!(
                "watchtower update request failed: endpoint={url}, token={token_state}, status=unreachable, error={err}. hint: verify ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_URL reachability and token configuration"
            )
        })?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let body = clip_text(text.trim(), 512);
        anyhow::bail!(
            "watchtower update failed: endpoint={url}, token={token_state}, status={status}, body={body}. hint: check WATCHTOWER_HTTP_API_TOKEN and /v1/update"
        );
    }

    if let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim()) {
        let failed = v
            .get("summary")
            .and_then(|s| s.get("failed"))
            .and_then(|n| n.as_u64())
            .unwrap_or(0);
        if failed > 0 {
            let scanned = v
                .get("summary")
                .and_then(|s| s.get("scanned"))
                .and_then(|n| n.as_u64())
                .unwrap_or(0);
            let updated = v
                .get("summary")
                .and_then(|s| s.get("updated"))
                .and_then(|n| n.as_u64())
                .unwrap_or(0);
            let restarted = v
                .get("summary")
                .and_then(|s| s.get("restarted"))
                .and_then(|n| n.as_u64())
                .unwrap_or(0);
            anyhow::bail!(
                "watchtower update reported failures: scanned={scanned} updated={updated} failed={failed} restarted={restarted}. hint: check watchtower logs and image availability, then retry or update manually"
            );
        }
    }

    Ok(text)
}

#[derive(Debug, Clone, Default)]
pub struct SelfUpdateApi;

#[tonic::async_trait]
impl AgentUpdateService for SelfUpdateApi {
    async fn get_self_update_status(
        &self,
        _request: Request<GetSelfUpdateStatusRequest>,
    ) -> Result<Response<GetSelfUpdateStatusResponse>, Status> {
        let s = self_update_status();
        Ok(Response::new(GetSelfUpdateStatusResponse {
            configured: s.configured,
            provider: s.provider,
            endpoint: s.endpoint,
        }))
    }

    async fn trigger_self_update(
        &self,
        _request: Request<TriggerSelfUpdateRequest>,
    ) -> Result<Response<TriggerSelfUpdateResponse>, Status> {
        let s = self_update_status();
        if !s.configured {
            return Err(Status::failed_precondition(crate::error_payload::encode(
                "not_supported",
                "self updater is not configured",
                None,
                Some(
                    "Set ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_TOKEN (and optional URL), then restart alloy-agent."
                        .to_string(),
                ),
            )));
        }

        let gate = evaluate_self_update_compatibility_gate().await;
        if gate.status != CompatibilityGateStatus::Updatable {
            let (code, msg, hint) = gate.into_error_payload();
            return Err(Status::failed_precondition(crate::error_payload::encode(
                &code,
                msg,
                None,
                hint,
            )));
        }

        let token = s.token.ok_or_else(|| {
            Status::failed_precondition(crate::error_payload::encode(
                "not_supported",
                "self updater is not configured",
                None,
                Some(
                    "Set ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_TOKEN (and optional URL), then restart alloy-agent."
                        .to_string(),
                ),
            ))
        })?;

        let message = trigger_watchtower_update(&s.endpoint, &token)
            .await
            .map_err(|e| {
                Status::internal(crate::error_payload::encode(
                    "updater_failed",
                    format!("trigger self update failed: {e}"),
                    None,
                    Some(
                        "Verify local watchtower container is running and token matches WATCHTOWER_HTTP_API_TOKEN."
                            .to_string(),
                    ),
                ))
            })?;

        Ok(Response::new(TriggerSelfUpdateResponse {
            ok: true,
            message,
        }))
    }
}

pub fn server() -> AgentUpdateServiceServer<SelfUpdateApi> {
    AgentUpdateServiceServer::new(SelfUpdateApi)
}
