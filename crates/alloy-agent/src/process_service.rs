use std::{collections::BTreeMap, time::Duration};

use alloy_proto::agent_v1::process_service_server::{ProcessService, ProcessServiceServer};
use alloy_proto::agent_v1::{
    CacheEntry, ClearCacheRequest, ClearCacheResponse, GetCacheStatsRequest, GetCacheStatsResponse,
    GetStatusRequest, GetStatusResponse, GetWarmTemplateProgressRequest,
    GetWarmTemplateProgressResponse, ListProcessesRequest, ListProcessesResponse,
    ListTemplatesRequest, ListTemplatesResponse, ProcessResources, ProcessState, ProcessStatus,
    ProcessTemplate, StartFromTemplateRequest, StartFromTemplateResponse, StopProcessRequest,
    StopProcessResponse, TailLogsRequest, TailLogsResponse, WarmTemplateCacheRequest,
    WarmTemplateCacheResponse,
};
use tonic::{Request, Response, Status};

use crate::process_manager::ProcessManager;
use crate::{
    core_keeper_download, dst_download, factorio_download, minecraft_download, palworld_download,
    seven_days_download, sons_of_the_forest_download, terraria_download, the_forest_download,
};

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
        let progress_id = req.progress_id.trim().to_string();

        let progress_set = !progress_id.is_empty();
        let report_progress = |stage: &str,
                               downloaded_bytes: Option<u64>,
                               total_bytes: Option<u64>,
                               speed_bytes_per_sec: Option<u64>,
                               message: String,
                               done: Option<bool>| {
            if !progress_set {
                return;
            }
            crate::download_progress::update(
                &progress_id,
                crate::download_progress::UpdateArgs {
                    stage: Some(stage.to_string()),
                    downloaded_bytes,
                    total_bytes,
                    speed_bytes_per_sec,
                    message: Some(message),
                    done,
                },
            );
        };

        let message = match req.template_id.as_str() {
            "minecraft:vanilla" => {
                let version = params
                    .get("version")
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("latest_release");

                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "resolve",
                        format!("resolving minecraft version {version}..."),
                        None,
                    );
                }

                let resolved = minecraft_download::resolve_server_jar(version)
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to resolve minecraft server jar: {e}"),
                            );
                        }
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

                report_progress(
                    "download",
                    Some(0),
                    Some(resolved.size),
                    Some(0),
                    format!("downloading minecraft {}...", resolved.version_id),
                    Some(false),
                );

                let mut last_downloaded = 0u64;
                let mut last_total = resolved.size;
                let mut last_speed = 0u64;
                let jar_path = minecraft_download::ensure_server_jar_with_progress(
                    &resolved,
                    Some(|downloaded: u64, total: u64, speed: u64| {
                        last_downloaded = downloaded;
                        last_total = total.max(resolved.size);
                        last_speed = speed;
                        report_progress(
                            "download",
                            Some(downloaded),
                            Some(total.max(resolved.size)),
                            Some(speed),
                            format!(
                                "downloading minecraft {} ({downloaded}/{})",
                                resolved.version_id,
                                total.max(resolved.size)
                            ),
                            Some(false),
                        );
                    }),
                )
                .await
                .map_err(|e| {
                    if progress_set {
                        crate::download_progress::fail(
                            &progress_id,
                            format!("failed to download minecraft server jar: {e}"),
                        );
                    }
                    Status::internal(crate::error_payload::encode(
                        "download_failed",
                        format!("failed to download minecraft server jar: {e}"),
                        None,
                        Some("Try again; if it persists, clear cache and retry.".to_string()),
                    ))
                })?;

                report_progress(
                    "verify",
                    Some(last_downloaded.max(resolved.size)),
                    Some(last_total.max(resolved.size)),
                    Some(last_speed),
                    format!("verifying minecraft {} integrity...", resolved.version_id),
                    Some(false),
                );

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        format!("minecraft {} ready", resolved.version_id),
                        last_downloaded.max(resolved.size),
                        last_total.max(resolved.size),
                        last_speed,
                    );
                }

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

                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "resolve",
                        format!("resolving terraria version {version}..."),
                        None,
                    );
                }

                let resolved = terraria_download::resolve_server_zip(version).map_err(|e| {
                    if progress_set {
                        crate::download_progress::fail(
                            &progress_id,
                            format!("failed to resolve terraria server zip: {e}"),
                        );
                    }
                    Status::invalid_argument(crate::error_payload::encode(
                        "download_failed",
                        format!("failed to resolve terraria server zip: {e}"),
                        None,
                        Some("Check network connectivity, then try again.".to_string()),
                    ))
                })?;

                report_progress(
                    "download",
                    Some(0),
                    Some(0),
                    Some(0),
                    format!("downloading terraria {}...", resolved.version_id),
                    Some(false),
                );

                let mut last_downloaded = 0u64;
                let mut last_total = 0u64;
                let mut last_speed = 0u64;
                let zip_path = terraria_download::ensure_server_zip_with_progress(
                    &resolved,
                    Some(|downloaded: u64, total: u64, speed: u64| {
                        last_downloaded = downloaded;
                        last_total = total.max(downloaded);
                        last_speed = speed;
                        report_progress(
                            "download",
                            Some(downloaded),
                            Some(total.max(downloaded)),
                            Some(speed),
                            format!(
                                "downloading terraria {} ({downloaded}/{})",
                                resolved.version_id,
                                total.max(downloaded)
                            ),
                            Some(false),
                        );
                    }),
                )
                .await
                .map_err(|e| {
                    if progress_set {
                        crate::download_progress::fail(
                            &progress_id,
                            format!("failed to download terraria server zip: {e}"),
                        );
                    }
                    Status::internal(crate::error_payload::encode(
                        "download_failed",
                        format!("failed to download terraria server zip: {e}"),
                        None,
                        Some("Try again; if it persists, clear cache and retry.".to_string()),
                    ))
                })?;

                report_progress(
                    "extract",
                    Some(last_downloaded),
                    Some(last_total.max(last_downloaded)),
                    Some(last_speed),
                    format!("extracting terraria {} files...", resolved.version_id),
                    Some(false),
                );

                let extracted =
                    terraria_download::extract_linux_x64_to_cache(&zip_path, &resolved.version_id)
                        .map_err(|e| {
                            if progress_set {
                                crate::download_progress::fail(
                                    &progress_id,
                                    format!("failed to extract terraria server: {e}"),
                                );
                            }
                            Status::internal(crate::error_payload::encode(
                                "download_failed",
                                format!("failed to extract terraria server: {e}"),
                                None,
                                Some("Clear cache and retry extraction.".to_string()),
                            ))
                        })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        format!("terraria {} ready", resolved.version_id),
                        last_downloaded,
                        last_total.max(last_downloaded),
                        last_speed,
                    );
                }

                format!(
                    "terraria cache warmed: version={} zip_path={} server_root={}",
                    resolved.version_id,
                    zip_path.display(),
                    extracted.server_root.display()
                )
            }
            "dst:vanilla" => {
                let version = params
                    .get("version")
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("latest");

                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "install",
                        format!("installing dst dedicated server ({version}) via steamcmd..."),
                        None,
                    );
                }

                let installed = dst_download::ensure_dst_server().await.map_err(|e| {
                    if progress_set {
                        crate::download_progress::fail(
                            &progress_id,
                            format!("failed to install dst dedicated server: {e}"),
                        );
                    }
                    Status::internal(crate::error_payload::encode(
                        "download_failed",
                        format!("failed to install dst dedicated server: {e}"),
                        None,
                        Some(
                            "SteamCMD install failed. Check network and runtime dependencies."
                                .to_string(),
                        ),
                    ))
                })?;

                if progress_set {
                    crate::download_progress::finish(&progress_id, "dst cache warmed", 0, 0, 0);
                }

                format!(
                    "dst cache warmed: version={} server_root={} bin={}",
                    version,
                    installed.server_root.display(),
                    installed.bin.display()
                )
            }
            "palworld:vanilla" => {
                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "install",
                        "installing palworld server files via steamcmd...",
                        None,
                    );
                }

                let installed = palworld_download::ensure_palworld_server()
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to install palworld server: {e}"),
                            );
                        }
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to install palworld server: {e}"),
                            None,
                            Some(
                                "SteamCMD install failed. Check network and runtime dependencies."
                                    .to_string(),
                            ),
                        ))
                    })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        "palworld cache warmed",
                        0,
                        0,
                        0,
                    );
                }

                format!(
                    "palworld cache warmed: server_root={} launcher={}",
                    installed.server_root.display(),
                    installed.launcher.display()
                )
            }
            "factorio:vanilla" => {
                let version = params
                    .get("version")
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("stable");

                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "resolve",
                        format!("resolving factorio version {version}..."),
                        None,
                    );
                }

                let resolved = factorio_download::resolve_server_package(version).map_err(|e| {
                    if progress_set {
                        crate::download_progress::fail(
                            &progress_id,
                            format!("failed to resolve factorio package: {e}"),
                        );
                    }
                    Status::invalid_argument(crate::error_payload::encode(
                        "download_failed",
                        format!("failed to resolve factorio package: {e}"),
                        None,
                        Some("Check version/channel and network connectivity.".to_string()),
                    ))
                })?;

                report_progress(
                    "download",
                    Some(0),
                    Some(0),
                    Some(0),
                    format!("downloading factorio {}...", resolved.version_id),
                    Some(false),
                );

                let package_path = factorio_download::ensure_server_package(&resolved)
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to download factorio package: {e}"),
                            );
                        }
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to download factorio package: {e}"),
                            None,
                            Some("Try again; if it persists, clear cache and retry.".to_string()),
                        ))
                    })?;

                report_progress(
                    "extract",
                    Some(0),
                    Some(0),
                    Some(0),
                    format!("extracting factorio {} files...", resolved.version_id),
                    Some(false),
                );

                let extracted =
                    factorio_download::extract_server_to_cache(&package_path, &resolved.version_id)
                        .map_err(|e| {
                            if progress_set {
                                crate::download_progress::fail(
                                    &progress_id,
                                    format!("failed to extract factorio package: {e}"),
                                );
                            }
                            Status::internal(crate::error_payload::encode(
                                "download_failed",
                                format!("failed to extract factorio package: {e}"),
                                None,
                                Some("Clear cache and retry extraction.".to_string()),
                            ))
                        })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        format!("factorio {} ready", resolved.version_id),
                        0,
                        0,
                        0,
                    );
                }

                format!(
                    "factorio cache warmed: version={} package_path={} server_root={}",
                    resolved.version_id,
                    package_path.display(),
                    extracted.server_root.display()
                )
            }
            "core_keeper:vanilla" => {
                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "install",
                        "installing core keeper dedicated server...",
                        None,
                    );
                }

                let installed = core_keeper_download::ensure_core_keeper_server()
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to install core keeper server: {e}"),
                            );
                        }
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to install core keeper server: {e}"),
                            None,
                            Some(
                                "SteamCMD install failed. Check network and 32-bit runtime dependencies in agent image."
                                    .to_string(),
                            ),
                        ))
                    })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        "core keeper cache warmed",
                        0,
                        0,
                        0,
                    );
                }

                format!(
                    "core keeper cache warmed: server_root={} launcher={}",
                    installed.server_root.display(),
                    installed.launcher.display()
                )
            }
            "seven_days:vanilla" => {
                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "install",
                        "installing 7 days to die dedicated server...",
                        None,
                    );
                }

                let installed = seven_days_download::ensure_seven_days_server()
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to install 7 days to die server: {e}"),
                            );
                        }
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to install 7 days to die server: {e}"),
                            None,
                            Some(
                                "SteamCMD install failed. Check network and 32-bit runtime dependencies in agent image."
                                    .to_string(),
                            ),
                        ))
                    })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        "7 days to die cache warmed",
                        0,
                        0,
                        0,
                    );
                }

                format!(
                    "7 days to die cache warmed: server_root={} launcher={}",
                    installed.server_root.display(),
                    installed.launcher.display()
                )
            }
            "the_forest:vanilla" => {
                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "install",
                        "installing the forest dedicated server...",
                        None,
                    );
                }

                let installed = the_forest_download::ensure_the_forest_server()
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to install the forest server: {e}"),
                            );
                        }
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to install the forest server: {e}"),
                            None,
                            Some(
                                "SteamCMD install failed. Check network and 32-bit runtime dependencies in agent image."
                                    .to_string(),
                            ),
                        ))
                    })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        "the forest cache warmed",
                        0,
                        0,
                        0,
                    );
                }

                format!(
                    "the forest cache warmed: server_root={} launcher={}",
                    installed.server_root.display(),
                    installed.launcher.display()
                )
            }
            "sons_of_the_forest:vanilla" => {
                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "install",
                        "installing sons of the forest dedicated server...",
                        None,
                    );
                }

                let installed = sons_of_the_forest_download::ensure_sons_of_the_forest_server()
                    .await
                    .map_err(|e| {
                        if progress_set {
                            crate::download_progress::fail(
                                &progress_id,
                                format!("failed to install sons of the forest server: {e}"),
                            );
                        }
                        Status::internal(crate::error_payload::encode(
                            "download_failed",
                            format!("failed to install sons of the forest server: {e}"),
                            None,
                            Some(
                                "SteamCMD install failed. Check network and 32-bit runtime dependencies in agent image."
                                    .to_string(),
                            ),
                        ))
                    })?;

                if progress_set {
                    crate::download_progress::finish(
                        &progress_id,
                        "sons of the forest cache warmed",
                        0,
                        0,
                        0,
                    );
                }

                format!(
                    "sons of the forest cache warmed: server_root={} launcher={}",
                    installed.server_root.display(),
                    installed.launcher.display()
                )
            }
            "demo:sleep" => {
                if progress_set {
                    crate::download_progress::start(
                        &progress_id,
                        "ready",
                        "no cache needed for demo:sleep",
                        Some(0),
                    );
                    crate::download_progress::finish(
                        &progress_id,
                        "no cache needed for demo:sleep",
                        0,
                        0,
                        0,
                    );
                }
                "no cache needed for demo:sleep".to_string()
            }
            _ => return Err(Status::invalid_argument("unknown template_id")),
        };

        Ok(Response::new(WarmTemplateCacheResponse {
            ok: true,
            message,
        }))
    }

    async fn get_warm_template_progress(
        &self,
        request: Request<GetWarmTemplateProgressRequest>,
    ) -> Result<Response<GetWarmTemplateProgressResponse>, Status> {
        let req = request.into_inner();
        let progress_id = req.progress_id.trim();
        if progress_id.is_empty() {
            return Ok(Response::new(GetWarmTemplateProgressResponse {
                found: false,
                stage: String::new(),
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_bytes_per_sec: 0,
                message: String::new(),
                done: false,
                updated_at_unix_ms: 0,
            }));
        }

        let snapshot = crate::download_progress::get(progress_id);
        let Some(snapshot) = snapshot else {
            return Ok(Response::new(GetWarmTemplateProgressResponse {
                found: false,
                stage: String::new(),
                downloaded_bytes: 0,
                total_bytes: 0,
                speed_bytes_per_sec: 0,
                message: String::new(),
                done: false,
                updated_at_unix_ms: 0,
            }));
        };

        Ok(Response::new(GetWarmTemplateProgressResponse {
            found: true,
            stage: snapshot.stage,
            downloaded_bytes: snapshot.downloaded_bytes,
            total_bytes: snapshot.total_bytes,
            speed_bytes_per_sec: snapshot.speed_bytes_per_sec,
            message: snapshot.message,
            done: snapshot.done,
            updated_at_unix_ms: snapshot.updated_at_unix_ms,
        }))
    }

    async fn get_cache_stats(
        &self,
        _request: Request<GetCacheStatsRequest>,
    ) -> Result<Response<GetCacheStatsResponse>, Status> {
        #[derive(Debug, Clone, serde::Deserialize)]
        struct MinecraftJarMeta {
            version_id: Option<String>,
        }

        fn read_last_used_marker(dir: &std::path::Path) -> u64 {
            let p = dir.join(".last_used");
            let raw = std::fs::read_to_string(p).unwrap_or_default();
            raw.trim().parse::<u64>().unwrap_or(0)
        }

        fn read_minecraft_version_id(entry_dir: &std::path::Path) -> Option<String> {
            let p = entry_dir.join("meta.json");
            let bytes = std::fs::read(p).ok()?;
            let meta: MinecraftJarMeta = serde_json::from_slice(&bytes).ok()?;
            meta.version_id
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
        }

        fn modified_unix_ms(path: &std::path::Path) -> u64 {
            let meta = match std::fs::symlink_metadata(path) {
                Ok(m) => m,
                Err(_) => return 0,
            };
            meta.modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0)
        }

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
            let mut out: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();

            // Minecraft: per-JAR entries (key includes version + sha1).
            let mc_root = minecraft_download::cache_dir();
            let mut mc_entries: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&mc_root) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    let Ok(ft) = entry.file_type() else {
                        continue;
                    };
                    if !ft.is_dir() {
                        continue;
                    }
                    let sha1 = entry.file_name().to_string_lossy().to_string();
                    if sha1.len() != 40 || !sha1.chars().all(|c| c.is_ascii_hexdigit()) {
                        continue;
                    }
                    let jar = path.join("server.jar");
                    if !jar.is_file() {
                        continue;
                    }

                    let version =
                        read_minecraft_version_id(&path).unwrap_or_else(|| "unknown".to_string());
                    let (size, _) = dir_stats(&path);
                    let last_used = read_last_used_marker(&path).max(modified_unix_ms(&jar));
                    let key = format!("minecraft:vanilla@{version}#{sha1}");
                    mc_entries.push((key, path, size, last_used));
                }
            }
            mc_entries.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
            let mc_size = mc_entries.iter().map(|e| e.2).sum::<u64>();
            let mc_last = mc_entries.iter().map(|e| e.3).max().unwrap_or(0);
            out.push((
                "minecraft:vanilla".to_string(),
                mc_root.clone(),
                mc_size,
                mc_last,
            ));
            out.extend(mc_entries);

            // Terraria: per-version entries (key includes version).
            let tr_root = terraria_download::cache_dir();
            let mut tr_entries: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&tr_root) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    let Ok(ft) = entry.file_type() else {
                        continue;
                    };
                    if !ft.is_dir() {
                        continue;
                    }
                    let version = entry.file_name().to_string_lossy().to_string();
                    if version.is_empty() {
                        continue;
                    }
                    if !version.chars().all(|c| c.is_ascii_digit()) {
                        continue;
                    }

                    let (size, last_modified) = dir_stats(&path);
                    let last_used = read_last_used_marker(&path).max(last_modified);
                    let key = format!("terraria:vanilla@{version}");
                    tr_entries.push((key, path, size, last_used));
                }
            }
            tr_entries.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
            let tr_size = tr_entries.iter().map(|e| e.2).sum::<u64>();
            let tr_last = tr_entries.iter().map(|e| e.3).max().unwrap_or(0);
            out.push((
                "terraria:vanilla".to_string(),
                tr_root.clone(),
                tr_size,
                tr_last,
            ));
            out.extend(tr_entries);

            // DST: steamcmd install cache (typically a single "latest" entry).
            let dst_root = crate::minecraft::data_root()
                .join("cache")
                .join("dst")
                .join("vanilla");
            let mut dst_entries: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&dst_root) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    let Ok(ft) = entry.file_type() else {
                        continue;
                    };
                    if !ft.is_dir() {
                        continue;
                    }
                    let version = entry.file_name().to_string_lossy().to_string();
                    if version.trim().is_empty() {
                        continue;
                    }

                    let (size, last_modified) = dir_stats(&path);
                    let last_used = read_last_used_marker(&path).max(last_modified);
                    let key = format!("dst:vanilla@{version}");
                    dst_entries.push((key, path, size, last_used));
                }
            }
            dst_entries.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
            let dst_size = dst_entries.iter().map(|e| e.2).sum::<u64>();
            let dst_last = dst_entries.iter().map(|e| e.3).max().unwrap_or(0);
            out.push((
                "dst:vanilla".to_string(),
                dst_root.clone(),
                dst_size,
                dst_last,
            ));
            out.extend(dst_entries);

            // Palworld: steamcmd install cache (typically a single "latest" entry).
            let pw_root = crate::palworld::data_root()
                .join("cache")
                .join("palworld")
                .join("vanilla");
            let mut pw_entries: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&pw_root) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    let Ok(ft) = entry.file_type() else {
                        continue;
                    };
                    if !ft.is_dir() {
                        continue;
                    }
                    let version = entry.file_name().to_string_lossy().to_string();
                    if version.trim().is_empty() {
                        continue;
                    }

                    let (size, last_modified) = dir_stats(&path);
                    let last_used = read_last_used_marker(&path).max(last_modified);
                    let key = format!("palworld:vanilla@{version}");
                    pw_entries.push((key, path, size, last_used));
                }
            }
            pw_entries.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
            let pw_size = pw_entries.iter().map(|e| e.2).sum::<u64>();
            let pw_last = pw_entries.iter().map(|e| e.3).max().unwrap_or(0);
            out.push((
                "palworld:vanilla".to_string(),
                pw_root.clone(),
                pw_size,
                pw_last,
            ));
            out.extend(pw_entries);

            // Factorio: per-version extracted/download cache.
            let fx_root = crate::factorio::data_root()
                .join("cache")
                .join("factorio")
                .join("vanilla");
            let mut fx_entries: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();
            if let Ok(rd) = std::fs::read_dir(&fx_root) {
                for entry in rd.flatten() {
                    let path = entry.path();
                    let Ok(ft) = entry.file_type() else {
                        continue;
                    };
                    if !ft.is_dir() {
                        continue;
                    }
                    let version = entry.file_name().to_string_lossy().to_string();
                    if version.trim().is_empty() {
                        continue;
                    }

                    let (size, last_modified) = dir_stats(&path);
                    let last_used = read_last_used_marker(&path).max(last_modified);
                    let key = format!("factorio:vanilla@{version}");
                    fx_entries.push((key, path, size, last_used));
                }
            }
            fx_entries.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
            let fx_size = fx_entries.iter().map(|e| e.2).sum::<u64>();
            let fx_last = fx_entries.iter().map(|e| e.3).max().unwrap_or(0);
            out.push((
                "factorio:vanilla".to_string(),
                fx_root.clone(),
                fx_size,
                fx_last,
            ));
            out.extend(fx_entries);

            // Steam app based caches: latest install directory entries.
            for (template, root) in [
                (
                    "core_keeper:vanilla",
                    crate::core_keeper::data_root()
                        .join("cache")
                        .join("core_keeper")
                        .join("vanilla"),
                ),
                (
                    "seven_days:vanilla",
                    crate::seven_days::data_root()
                        .join("cache")
                        .join("seven_days")
                        .join("vanilla"),
                ),
                (
                    "the_forest:vanilla",
                    crate::the_forest::data_root()
                        .join("cache")
                        .join("the_forest")
                        .join("vanilla"),
                ),
                (
                    "sons_of_the_forest:vanilla",
                    crate::sons_of_the_forest::data_root()
                        .join("cache")
                        .join("sons_of_the_forest")
                        .join("vanilla"),
                ),
            ] {
                let mut entries: Vec<(String, std::path::PathBuf, u64, u64)> = Vec::new();
                if let Ok(rd) = std::fs::read_dir(&root) {
                    for entry in rd.flatten() {
                        let path = entry.path();
                        let Ok(ft) = entry.file_type() else {
                            continue;
                        };
                        if !ft.is_dir() {
                            continue;
                        }
                        let version = entry.file_name().to_string_lossy().to_string();
                        if version.trim().is_empty() {
                            continue;
                        }

                        let (size, last_modified) = dir_stats(&path);
                        let last_used = read_last_used_marker(&path).max(last_modified);
                        let key = format!("{template}@{version}");
                        entries.push((key, path, size, last_used));
                    }
                }
                entries.sort_by(|a, b| b.3.cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
                let total_size = entries.iter().map(|e| e.2).sum::<u64>();
                let total_last = entries.iter().map(|e| e.3).max().unwrap_or(0);
                out.push((template.to_string(), root.clone(), total_size, total_last));
                out.extend(entries);
            }

            out
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
        fn template_id_for_cache_key(key: &str) -> Option<&'static str> {
            if key == "minecraft:vanilla" || key.starts_with("minecraft:vanilla@") {
                return Some("minecraft:vanilla");
            }
            if key == "terraria:vanilla" || key.starts_with("terraria:vanilla@") {
                return Some("terraria:vanilla");
            }
            if key == "dst:vanilla" || key.starts_with("dst:vanilla@") {
                return Some("dst:vanilla");
            }
            if key == "palworld:vanilla" || key.starts_with("palworld:vanilla@") {
                return Some("palworld:vanilla");
            }
            if key == "factorio:vanilla" || key.starts_with("factorio:vanilla@") {
                return Some("factorio:vanilla");
            }
            if key == "core_keeper:vanilla" || key.starts_with("core_keeper:vanilla@") {
                return Some("core_keeper:vanilla");
            }
            if key == "seven_days:vanilla" || key.starts_with("seven_days:vanilla@") {
                return Some("seven_days:vanilla");
            }
            if key == "the_forest:vanilla" || key.starts_with("the_forest:vanilla@") {
                return Some("the_forest:vanilla");
            }
            if key == "sons_of_the_forest:vanilla" || key.starts_with("sons_of_the_forest:vanilla@")
            {
                return Some("sons_of_the_forest:vanilla");
            }
            None
        }

        fn validate_sha1_hex(s: &str) -> bool {
            s.len() == 40 && s.chars().all(|c| c.is_ascii_hexdigit())
        }

        let req = request.into_inner();
        let keys: Vec<String> = if req.keys.is_empty() {
            vec![
                "minecraft:vanilla".to_string(),
                "terraria:vanilla".to_string(),
                "dst:vanilla".to_string(),
                "palworld:vanilla".to_string(),
                "factorio:vanilla".to_string(),
                "core_keeper:vanilla".to_string(),
                "seven_days:vanilla".to_string(),
                "the_forest:vanilla".to_string(),
                "sons_of_the_forest:vanilla".to_string(),
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
            let Some(template_id) = template_id_for_cache_key(key) else {
                return Err(Status::invalid_argument(format!(
                    "unknown cache key: {key}"
                )));
            };
            if running.contains(template_id) {
                return Err(Status::failed_precondition(format!(
                    "cannot clear cache while process is running: {template_id}"
                )));
            }
        }

        let mut freed_bytes = 0u64;
        let mut cleared = Vec::new();

        for key in keys {
            let dir = if key == "minecraft:vanilla" {
                minecraft_download::cache_dir()
            } else if let Some(rest) = key.strip_prefix("minecraft:vanilla@") {
                let (_, sha1) = rest.split_once('#').ok_or_else(|| {
                    Status::invalid_argument(format!("invalid minecraft cache key: {key}"))
                })?;
                if !validate_sha1_hex(sha1) {
                    return Err(Status::invalid_argument(format!(
                        "invalid minecraft cache sha1: {sha1}"
                    )));
                }
                minecraft_download::cache_dir().join(sha1)
            } else if key == "terraria:vanilla" {
                terraria_download::cache_dir()
            } else if let Some(version) = key.strip_prefix("terraria:vanilla@") {
                if version.is_empty() || !version.chars().all(|c| c.is_ascii_digit()) {
                    return Err(Status::invalid_argument(format!(
                        "invalid terraria cache key: {key}"
                    )));
                }
                terraria_download::cache_dir().join(version)
            } else if key == "dst:vanilla" {
                crate::minecraft::data_root()
                    .join("cache")
                    .join("dst")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("dst:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid dst cache key: {key}"
                    )));
                }
                crate::minecraft::data_root()
                    .join("cache")
                    .join("dst")
                    .join("vanilla")
                    .join(version)
            } else if key == "palworld:vanilla" {
                crate::palworld::data_root()
                    .join("cache")
                    .join("palworld")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("palworld:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid palworld cache key: {key}"
                    )));
                }
                crate::palworld::data_root()
                    .join("cache")
                    .join("palworld")
                    .join("vanilla")
                    .join(version)
            } else if key == "factorio:vanilla" {
                crate::factorio::data_root()
                    .join("cache")
                    .join("factorio")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("factorio:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid factorio cache key: {key}"
                    )));
                }
                crate::factorio::data_root()
                    .join("cache")
                    .join("factorio")
                    .join("vanilla")
                    .join(version)
            } else if key == "core_keeper:vanilla" {
                crate::core_keeper::data_root()
                    .join("cache")
                    .join("core_keeper")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("core_keeper:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid core keeper cache key: {key}"
                    )));
                }
                crate::core_keeper::data_root()
                    .join("cache")
                    .join("core_keeper")
                    .join("vanilla")
                    .join(version)
            } else if key == "seven_days:vanilla" {
                crate::seven_days::data_root()
                    .join("cache")
                    .join("seven_days")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("seven_days:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid seven days cache key: {key}"
                    )));
                }
                crate::seven_days::data_root()
                    .join("cache")
                    .join("seven_days")
                    .join("vanilla")
                    .join(version)
            } else if key == "the_forest:vanilla" {
                crate::the_forest::data_root()
                    .join("cache")
                    .join("the_forest")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("the_forest:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid the forest cache key: {key}"
                    )));
                }
                crate::the_forest::data_root()
                    .join("cache")
                    .join("the_forest")
                    .join("vanilla")
                    .join(version)
            } else if key == "sons_of_the_forest:vanilla" {
                crate::sons_of_the_forest::data_root()
                    .join("cache")
                    .join("sons_of_the_forest")
                    .join("vanilla")
            } else if let Some(version) = key.strip_prefix("sons_of_the_forest:vanilla@") {
                if version.trim().is_empty() {
                    return Err(Status::invalid_argument(format!(
                        "invalid sons of the forest cache key: {key}"
                    )));
                }
                crate::sons_of_the_forest::data_root()
                    .join("cache")
                    .join("sons_of_the_forest")
                    .join("vanilla")
                    .join(version)
            } else {
                return Err(Status::invalid_argument(format!(
                    "unknown cache key: {key}"
                )));
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
