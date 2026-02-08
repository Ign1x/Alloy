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

async fn trigger_watchtower_update(endpoint: &str, token: &str) -> anyhow::Result<String> {
    let url = format!("{}/v1/update", endpoint.trim_end_matches('/'));
    let resp = http_client()
        .get(url)
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

