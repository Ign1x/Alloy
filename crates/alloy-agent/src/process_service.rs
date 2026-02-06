use std::{collections::BTreeMap, time::Duration};

use alloy_proto::agent_v1::process_service_server::{ProcessService, ProcessServiceServer};
use alloy_proto::agent_v1::{
    CacheEntry, ClearCacheRequest, ClearCacheResponse, GetCacheStatsRequest, GetCacheStatsResponse,
    GetStatusRequest, GetStatusResponse, ListProcessesRequest, ListProcessesResponse,
    ListTemplatesRequest, ListTemplatesResponse, ProcessResources, ProcessState, ProcessStatus,
    ProcessTemplate, StartFromTemplateRequest, StartFromTemplateResponse, StopProcessRequest,
    StopProcessResponse, TailLogsRequest, TailLogsResponse, WarmTemplateCacheRequest,
    WarmTemplateCacheResponse,
};
use tonic::{Request, Response, Status};

use crate::process_manager::ProcessManager;
use crate::{dsp, dsp_source_init, minecraft_download, terraria_download};

#[derive(Debug, Clone)]
pub struct ProcessApi {
    manager: ProcessManager,
}

impl ProcessApi {
    pub fn new(manager: ProcessManager) -> Self {
        Self { manager }
    }
}

fn map_state(s: alloy_process::ProcessState) -> ProcessState {
    match s {
        alloy_process::ProcessState::Starting => ProcessState::Starting,
        alloy_process::ProcessState::Running => ProcessState::Running,
        alloy_process::ProcessState::Stopping => ProcessState::Stopping,
        alloy_process::ProcessState::Exited => ProcessState::Exited,
        alloy_process::ProcessState::Failed => ProcessState::Failed,
    }
}

pub fn map_status(s: alloy_process::ProcessStatus) -> ProcessStatus {
    ProcessStatus {
        process_id: s.id.0,
        template_id: s.template_id.0,
        state: map_state(s.state) as i32,
        pid: s.pid.unwrap_or_default(),
        has_pid: s.pid.is_some(),
        exit_code: s.exit_code.unwrap_or_default(),
        has_exit_code: s.exit_code.is_some(),
        message: s.message.unwrap_or_default(),
        resources: s.resources.map(|r| ProcessResources {
            cpu_percent_x100: r.cpu_percent_x100,
            rss_bytes: r.rss_bytes,
            read_bytes: r.read_bytes,
            write_bytes: r.write_bytes,
        }),
    }
}

#[tonic::async_trait]
impl ProcessService for ProcessApi {
    async fn list_templates(
        &self,
        _request: Request<ListTemplatesRequest>,
    ) -> Result<Response<ListTemplatesResponse>, Status> {
        let templates = self
            .manager
            .list_templates()
            .await
            .into_iter()
            .map(|t| ProcessTemplate {
                template_id: t.template_id,
                display_name: t.display_name,
                params: t.params,
            })
            .collect();

        Ok(Response::new(ListTemplatesResponse { templates }))
    }

    async fn start_from_template(
        &self,
        request: Request<StartFromTemplateRequest>,
    ) -> Result<Response<StartFromTemplateResponse>, Status> {
        let req = request.into_inner();
        let params: BTreeMap<String, String> = req.params.into_iter().collect();
        let status = self
            .manager
            .start_from_template(&req.template_id, params)
            .await
            .map_err(|e| Status::invalid_argument(e.to_string()))?;
        Ok(Response::new(StartFromTemplateResponse {
            status: Some(map_status(status)),
        }))
    }

    async fn warm_template_cache(
        &self,
        request: Request<WarmTemplateCacheRequest>,
    ) -> Result<Response<WarmTemplateCacheResponse>, Status> {
        let req = request.into_inner();
        let params: BTreeMap<String, String> = req.params.into_iter().collect();

        let message = match req.template_id.as_str() {
            "steamcmd:auth" => {
                let steam_username = params
                    .get("steam_username")
                    .map(|v| v.trim())
                    .unwrap_or_default();
                let steam_password = params
                    .get("steam_password")
                    .map(String::as_str)
                    .unwrap_or_default();
                let steam_guard_code = params
                    .get("steam_guard_code")
                    .map(|v| v.trim())
                    .filter(|v| !v.is_empty());

                let mut field_errors = BTreeMap::<String, String>::new();
                if steam_username.is_empty() {
                    field_errors.insert(
                        "steam_username".to_string(),
                        "Steam username is required.".to_string(),
                    );
                }
                if steam_password.is_empty() {
                    field_errors.insert(
                        "steam_password".to_string(),
                        "Steam password is required.".to_string(),
                    );
                }

                if !field_errors.is_empty() {
                    return Err(Status::invalid_argument(crate::error_payload::encode(
                        "invalid_param",
                        "SteamCMD credentials are required for login verification.",
                        Some(field_errors),
                        Some("Enter username and password, then retry Login.".to_string()),
                    )));
                }

                dsp_source_init::verify_steamcmd_login(
                    steam_username,
                    steam_password,
                    steam_guard_code,
                )
                .await
                .map_err(|e| {
                    let detail = format!("{e:#}");
                    let detail_l = detail.to_ascii_lowercase();
                    let mut field_errors = BTreeMap::<String, String>::new();

                    let (message, hint) = if detail_l.contains("steam guard")
                        || detail_l.contains("two-factor")
                        || detail_l.contains("2fa")
                    {
                        field_errors.insert(
                            "steam_guard_code".to_string(),
                            "Steam Guard code is required or invalid.".to_string(),
                        );
                        (
                            "Steam Guard verification is required.",
                            Some("Enter the latest Steam Guard code and retry Login.".to_string()),
                        )
                    } else if detail_l.contains("invalid password")
                        || detail_l.contains("login failure")
                        || detail_l.contains("incorrect login")
                        || detail_l.contains("account logon denied")
                    {
                        field_errors.insert(
                            "steam_password".to_string(),
                            "Steam username or password is incorrect.".to_string(),
                        );
                        (
                            "SteamCMD login failed: invalid credentials.",
                            Some("Check Steam username/password and retry Login.".to_string()),
                        )
                    } else if detail_l.contains("rate limit")
                        || detail_l.contains("too many")
                    {
                        (
                            "Steam login is temporarily rate-limited.",
                            Some("Wait a moment, then retry Login.".to_string()),
                        )
                    } else if detail_l.contains("timed out")
                        || detail_l.contains("dns")
                        || detail_l.contains("resolve")
                        || detail_l.contains("network")
                        || detail_l.contains("connection")
                    {
                        (
                            "SteamCMD login failed due to a network issue.",
                            Some("Check network connectivity and retry Login.".to_string()),
                        )
                    } else {
                        (
                            "SteamCMD login verification failed.",
                            Some("Retry Login. If it still fails, check agent logs with request id.".to_string()),
                        )
                    };

                    Status::invalid_argument(crate::error_payload::encode(
                        "invalid_param",
                        message,
                        if field_errors.is_empty() {
                            None
                        } else {
                            Some(field_errors)
                        },
                        hint,
                    ))
                })?;

                "steamcmd login verified".to_string()
            }
            "minecraft:vanilla" => {
                let version = params
                    .get("version")
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("latest_release");
                let resolved = minecraft_download::resolve_server_jar(version)
                    .await
                    .map_err(|e| {
                        Status::invalid_argument(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to resolve minecraft server jar: {e}"),
                            None,
                            Some(
                                "Check network connectivity to Mojang piston-meta endpoints."
                                    .to_string(),
                            ),
                        ))
                    })?;
                let jar_path = minecraft_download::ensure_server_jar(&resolved)
                    .await
                    .map_err(|e| {
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to download minecraft server jar: {e}"),
                            None,
                            Some("Try again; if it persists, clear cache and retry.".to_string()),
                        ))
                    })?;
                format!(
                    "minecraft cache warmed: version={} sha1={} path={}",
                    resolved.version_id,
                    resolved.sha1,
                    jar_path.display()
                )
            }
            "terraria:vanilla" => {
                let version = params
                    .get("version")
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("1453");
                let resolved = terraria_download::resolve_server_zip(version).map_err(|e| {
                    Status::invalid_argument(crate::error_payload::encode(
                        "download_failed",
                        format!("failed to resolve terraria server zip: {e}"),
                        None,
                        Some("Check network connectivity, then try again.".to_string()),
                    ))
                })?;
                let zip_path = terraria_download::ensure_server_zip(&resolved)
                    .await
                    .map_err(|e| {
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to download terraria server zip: {e}"),
                            None,
                            Some("Try again; if it persists, clear cache and retry.".to_string()),
                        ))
                    })?;
                let extracted =
                    terraria_download::extract_linux_x64_to_cache(&zip_path, &resolved.version_id)
                        .map_err(|e| {
                            Status::internal(crate::error_payload::encode(
                                "download_failed",
                                format!("failed to extract terraria server: {e}"),
                                None,
                                Some("Clear cache and retry extraction.".to_string()),
                            ))
                        })?;
                format!(
                    "terraria cache warmed: version={} zip_path={} server_root={}",
                    resolved.version_id,
                    zip_path.display(),
                    extracted.server_root.display()
                )
            }
            "dsp:nebula" => {
                let source_root = dsp::default_source_root();
                let source_errors = dsp::source_layout_errors(&source_root);

                let init_result = if source_errors.is_empty() {
                    None
                } else {
                    let steam_username = params
                        .get("steam_username")
                        .map(|v| v.trim())
                        .unwrap_or_default();
                    let steam_password = params
                        .get("steam_password")
                        .map(String::as_str)
                        .unwrap_or_default();
                    let steam_guard_code = params
                        .get("steam_guard_code")
                        .map(|v| v.trim())
                        .filter(|v| !v.is_empty());

                    let mut field_errors = BTreeMap::<String, String>::new();
                    if steam_username.is_empty() {
                        field_errors.insert(
                            "steam_username".to_string(),
                            "Steam username is required to initialize DSP source files.".to_string(),
                        );
                    }
                    if steam_password.is_empty() {
                        field_errors.insert(
                            "steam_password".to_string(),
                            "Steam password is required to initialize DSP source files.".to_string(),
                        );
                    }

                    if !field_errors.is_empty() {
                        return Err(Status::invalid_argument(crate::error_payload::encode(
                            "invalid_param",
                            format!(
                                "dsp source files are not initialized at {}",
                                source_root.display()
                            ),
                            Some(field_errors),
                            Some(
                                "In Create Instance → DSP, click Warm once and provide Steam credentials to initialize the default source root.".to_string(),
                            ),
                        )));
                    }

                    Some(
                        dsp_source_init::init_default_source(
                            steam_username,
                            steam_password,
                            steam_guard_code,
                        )
                        .await
                        .map_err(|e| {
                            let detail = format!("{e:#}");
                            let detail_l = detail.to_ascii_lowercase();
                            let mut field_errors = BTreeMap::<String, String>::new();
                            let hint = if detail_l.contains("steam guard")
                                || detail_l.contains("two-factor")
                                || detail_l.contains("2fa")
                            {
                                field_errors.insert(
                                    "steam_guard_code".to_string(),
                                    "Steam Guard code is required or invalid.".to_string(),
                                );
                                Some(
                                    "Enter the latest Steam Guard code and retry Warm."
                                        .to_string(),
                                )
                            } else if detail_l.contains("invalid password")
                                || detail_l.contains("login failure")
                                || detail_l.contains("password") && detail_l.contains("incorrect")
                            {
                                field_errors.insert(
                                    "steam_password".to_string(),
                                    "Steam password appears invalid.".to_string(),
                                );
                                Some(
                                    "Check SteamCMD credentials in Settings, then retry."
                                        .to_string(),
                                )
                            } else if detail_l.contains("rate limit")
                                || detail_l.contains("too many")
                            {
                                Some(
                                    "Steam login may be rate-limited. Wait a moment and retry."
                                        .to_string(),
                                )
                            } else {
                                Some(
                                    "Check Steam credentials, Steam Guard, and network access, then retry Warm."
                                        .to_string(),
                                )
                            };

                            Status::internal(crate::error_payload::encode(
                                "download_failed",
                                format!(
                                    "failed to initialize DSP source files\n\nDetails:\n{}",
                                    detail
                                ),
                                if field_errors.is_empty() {
                                    None
                                } else {
                                    Some(field_errors)
                                },
                                hint,
                            ))
                        })?,
                    )
                };

                let tr = dsp::validate_nebula_params(&params).map_err(|e| {
                    Status::invalid_argument(crate::error_payload::encode(
                        "invalid_param",
                        format!("invalid dsp params: {e}"),
                        None,
                        Some("Fix the highlighted fields, then try again.".to_string()),
                    ))
                })?;

                let marker = dsp::data_root().join("cache").join("dsp");
                tokio::fs::create_dir_all(&marker).await.map_err(|e| {
                    Status::internal(crate::error_payload::encode(
                        "spawn_failed",
                        format!("failed to prepare dsp cache marker dir: {e}"),
                        None,
                        Some("Check ALLOY_DATA_ROOT permissions, then retry.".to_string()),
                    ))
                })?;

                if let Some(init) = init_result {
                    let installed = if init.installed_packages.is_empty() {
                        "none (already present)".to_string()
                    } else {
                        init.installed_packages.join(",")
                    };
                    format!(
                        "dsp source initialized: root={} installed={} startup_mode={} cache={}",
                        init.source_root.display(),
                        installed,
                        tr.startup_mode.as_str(),
                        marker.display()
                    )
                } else {
                    format!(
                        "dsp cache check passed: server_root={} startup_mode={} cache={}",
                        tr.server_root.display(),
                        tr.startup_mode.as_str(),
                        marker.display()
                    )
                }
            }
            "demo:sleep" => "no cache needed for demo:sleep".to_string(),
            _ => return Err(Status::invalid_argument("unknown template_id")),
        };

        Ok(Response::new(WarmTemplateCacheResponse {
            ok: true,
            message,
        }))
    }

    async fn get_cache_stats(
        &self,
        _request: Request<GetCacheStatsRequest>,
    ) -> Result<Response<GetCacheStatsResponse>, Status> {
        fn dir_stats(path: &std::path::Path) -> (u64, u64) {
            fn walk(p: &std::path::Path, size: &mut u64, last_ms: &mut u64) {
                let meta = match std::fs::symlink_metadata(p) {
                    Ok(m) => m,
                    Err(_) => return,
                };

                let modified_ms = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                *last_ms = (*last_ms).max(modified_ms);

                if meta.file_type().is_symlink() {
                    *size = size.saturating_add(meta.len());
                    return;
                }
                if meta.is_file() {
                    *size = size.saturating_add(meta.len());
                    return;
                }
                if !meta.is_dir() {
                    return;
                }

                let rd = match std::fs::read_dir(p) {
                    Ok(v) => v,
                    Err(_) => return,
                };
                for e in rd.flatten() {
                    walk(&e.path(), size, last_ms);
                }
            }

            if !path.exists() {
                return (0, 0);
            }

            let mut size = 0u64;
            let mut last_ms = 0u64;
            walk(path, &mut size, &mut last_ms);
            (size, last_ms)
        }

        let entries = tokio::task::spawn_blocking(|| {
            let (mc_size, mc_last) = dir_stats(&minecraft_download::cache_dir());
            let (tr_size, tr_last) = dir_stats(&terraria_download::cache_dir());
            let (dsp_size, dsp_last) = dir_stats(&dsp::data_root().join("cache").join("dsp"));
            vec![
                (
                    "minecraft:vanilla".to_string(),
                    minecraft_download::cache_dir(),
                    mc_size,
                    mc_last,
                ),
                (
                    "terraria:vanilla".to_string(),
                    terraria_download::cache_dir(),
                    tr_size,
                    tr_last,
                ),
                (
                    "dsp:nebula".to_string(),
                    dsp::data_root().join("cache").join("dsp"),
                    dsp_size,
                    dsp_last,
                ),
            ]
        })
        .await
        .map_err(|e| Status::internal(format!("cache stats task failed: {e}")))?
        .into_iter()
        .map(|(key, path, size_bytes, last_used_unix_ms)| CacheEntry {
            key,
            path: path.display().to_string(),
            size_bytes,
            last_used_unix_ms,
        })
        .collect();

        Ok(Response::new(GetCacheStatsResponse { entries }))
    }

    async fn clear_cache(
        &self,
        request: Request<ClearCacheRequest>,
    ) -> Result<Response<ClearCacheResponse>, Status> {
        let req = request.into_inner();
        let keys: Vec<String> = if req.keys.is_empty() {
            vec![
                "minecraft:vanilla".to_string(),
                "terraria:vanilla".to_string(),
                "dsp:nebula".to_string(),
            ]
        } else {
            req.keys
        };

        let running = self
            .manager
            .list_processes()
            .await
            .into_iter()
            .filter(|p| {
                matches!(
                    p.state,
                    alloy_process::ProcessState::Running
                        | alloy_process::ProcessState::Starting
                        | alloy_process::ProcessState::Stopping
                )
            })
            .map(|p| p.template_id.0)
            .collect::<std::collections::HashSet<_>>();

        for key in &keys {
            if running.contains(key) {
                return Err(Status::failed_precondition(format!(
                    "cannot clear cache while process is running: {key}"
                )));
            }
        }

        let mut freed_bytes = 0u64;
        let mut cleared = Vec::new();

        for key in keys {
            let dir = match key.as_str() {
                "minecraft:vanilla" => minecraft_download::cache_dir(),
                "terraria:vanilla" => terraria_download::cache_dir(),
                "dsp:nebula" => {
                    return Err(Status::invalid_argument(
                        "cache clear for dsp:nebula is disabled to avoid deleting worlds; manage instances explicitly"
                            .to_string(),
                    ))
                }
                _ => {
                    return Err(Status::invalid_argument(format!(
                        "unknown cache key: {key}"
                    )));
                }
            };

            let (size_bytes, last_used_unix_ms) = tokio::task::spawn_blocking({
                let dir = dir.clone();
                move || {
                    let (size, last) = if dir.exists() {
                        // Use the same stats logic as get_cache_stats.
                        let mut size = 0u64;
                        let mut last = 0u64;
                        fn walk(p: &std::path::Path, size: &mut u64, last_ms: &mut u64) {
                            let meta = match std::fs::symlink_metadata(p) {
                                Ok(m) => m,
                                Err(_) => return,
                            };
                            let modified_ms = meta
                                .modified()
                                .ok()
                                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                .map(|d| d.as_millis() as u64)
                                .unwrap_or(0);
                            *last_ms = (*last_ms).max(modified_ms);
                            if meta.file_type().is_symlink() {
                                *size = size.saturating_add(meta.len());
                                return;
                            }
                            if meta.is_file() {
                                *size = size.saturating_add(meta.len());
                                return;
                            }
                            if !meta.is_dir() {
                                return;
                            }
                            let rd = match std::fs::read_dir(p) {
                                Ok(v) => v,
                                Err(_) => return,
                            };
                            for e in rd.flatten() {
                                walk(&e.path(), size, last_ms);
                            }
                        }
                        walk(&dir, &mut size, &mut last);
                        (size, last)
                    } else {
                        (0, 0)
                    };
                    (size, last)
                }
            })
            .await
            .unwrap_or((0, 0));

            if dir.exists() {
                tokio::fs::remove_dir_all(&dir)
                    .await
                    .map_err(|e| Status::internal(format!("failed to clear cache: {e}")))?;
            }

            freed_bytes = freed_bytes.saturating_add(size_bytes);
            cleared.push(CacheEntry {
                key: key.clone(),
                path: dir.display().to_string(),
                size_bytes,
                last_used_unix_ms,
            });
        }

        Ok(Response::new(ClearCacheResponse {
            ok: true,
            freed_bytes,
            cleared,
        }))
    }

    async fn stop(
        &self,
        request: Request<StopProcessRequest>,
    ) -> Result<Response<StopProcessResponse>, Status> {
        let req = request.into_inner();
        let timeout = if req.timeout_ms == 0 {
            Duration::from_secs(30)
        } else {
            Duration::from_millis(req.timeout_ms as u64)
        };

        let status = self
            .manager
            .stop(&req.process_id, timeout)
            .await
            .map_err(|e| Status::not_found(e.to_string()))?;
        Ok(Response::new(StopProcessResponse {
            status: Some(map_status(status)),
        }))
    }

    async fn list_processes(
        &self,
        _request: Request<ListProcessesRequest>,
    ) -> Result<Response<ListProcessesResponse>, Status> {
        let processes = self
            .manager
            .list_processes()
            .await
            .into_iter()
            .map(map_status)
            .collect();
        Ok(Response::new(ListProcessesResponse { processes }))
    }

    async fn get_status(
        &self,
        request: Request<GetStatusRequest>,
    ) -> Result<Response<GetStatusResponse>, Status> {
        let req = request.into_inner();
        let status = self
            .manager
            .get_status(&req.process_id)
            .await
            .ok_or_else(|| Status::not_found("unknown process_id"))?;
        Ok(Response::new(GetStatusResponse {
            status: Some(map_status(status)),
        }))
    }

    async fn tail_logs(
        &self,
        request: Request<TailLogsRequest>,
    ) -> Result<Response<TailLogsResponse>, Status> {
        let req = request.into_inner();
        let limit = if req.limit == 0 {
            100
        } else {
            req.limit as usize
        };
        let cursor: u64 = req.cursor.parse().unwrap_or(0);
        let (lines, next) = self
            .manager
            .tail_logs(&req.process_id, cursor, limit)
            .await
            .map_err(|e| Status::not_found(e.to_string()))?;

        Ok(Response::new(TailLogsResponse {
            lines,
            next_cursor: next.to_string(),
        }))
    }
}

pub fn server(manager: ProcessManager) -> ProcessServiceServer<ProcessApi> {
    ProcessServiceServer::new(ProcessApi::new(manager))
}
