use std::{collections::BTreeMap, path::PathBuf};

use alloy_proto::agent_v1::instance_service_server::{InstanceService, InstanceServiceServer};
use alloy_proto::agent_v1::{
    CreateInstanceRequest, CreateInstanceResponse, DeleteInstancePreviewRequest,
    DeleteInstancePreviewResponse, DeleteInstanceRequest, DeleteInstanceResponse,
    GetInstanceRequest, GetInstanceResponse, InstanceConfig, InstanceInfo, ListInstancesRequest,
    ListInstancesResponse, StartInstanceRequest, StartInstanceResponse, StopInstanceRequest,
    StopInstanceResponse, UpdateInstanceRequest, UpdateInstanceResponse,
};
use tokio::io::AsyncWriteExt;
use tonic::{Request, Response, Status};

use crate::port_alloc;
use crate::process_manager::ProcessManager;

const INSTANCES_DIR: &str = "instances";

#[derive(Debug)]
enum IdError {
    Empty,
    Invalid,
}

impl From<IdError> for Status {
    fn from(value: IdError) -> Self {
        match value {
            IdError::Empty => Status::invalid_argument("instance_id must be non-empty"),
            IdError::Invalid => Status::invalid_argument("invalid instance_id"),
        }
    }
}

fn data_root() -> PathBuf {
    // Re-use the same env var as Minecraft data root.
    crate::minecraft::data_root()
}

fn normalize_instance_id(id: &str) -> Result<String, IdError> {
    let id = id.trim();
    if id.is_empty() {
        return Err(IdError::Empty);
    }

    // Keep instance ids safe for filesystem paths.
    if !id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        return Err(IdError::Invalid);
    }

    Ok(id.to_string())
}

fn instance_dir(instance_id: &str) -> Result<PathBuf, IdError> {
    let id = normalize_instance_id(instance_id)?;
    Ok(data_root().join(INSTANCES_DIR).join(id))
}

fn instance_config_path(instance_id: &str) -> Result<PathBuf, IdError> {
    Ok(instance_dir(instance_id)?.join("instance.json"))
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct PersistedInstance {
    instance_id: String,
    template_id: String,
    params: BTreeMap<String, String>,
    #[serde(default)]
    display_name: Option<String>,
}

impl PersistedInstance {
    fn to_proto(&self) -> InstanceConfig {
        InstanceConfig {
            instance_id: self.instance_id.clone(),
            template_id: self.template_id.clone(),
            params: self.params.clone().into_iter().collect(),
            display_name: self.display_name.clone().unwrap_or_default(),
        }
    }
}

async fn load_instance(instance_id: &str) -> Result<PersistedInstance, Status> {
    let path = instance_config_path(instance_id).map_err(Status::from)?;
    let raw = tokio::fs::read(&path)
        .await
        .map_err(|_| Status::not_found("instance not found"))?;
    serde_json::from_slice::<PersistedInstance>(&raw)
        .map_err(|e| Status::internal(format!("failed to parse instance config: {e}")))
}

async fn save_instance(inst: &PersistedInstance) -> Result<(), Status> {
    let dir = instance_dir(&inst.instance_id).map_err(Status::from)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| Status::internal(format!("failed to create instance dir: {e}")))?;

    let path = instance_config_path(&inst.instance_id).map_err(Status::from)?;
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_vec_pretty(inst)
        .map_err(|e| Status::internal(format!("failed to serialize instance config: {e}")))?;

    let mut f = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| Status::internal(format!("failed to write temp file: {e}")))?;
    f.write_all(&data)
        .await
        .map_err(|e| Status::internal(format!("failed to write temp file: {e}")))?;
    f.flush()
        .await
        .map_err(|e| Status::internal(format!("failed to flush temp file: {e}")))?;

    tokio::fs::rename(&tmp, &path)
        .await
        .map_err(|e| Status::internal(format!("failed to persist instance config: {e}")))?;

    Ok(())
}

fn template_needs_port(template_id: &str) -> bool {
    template_id == "minecraft:vanilla" || template_id == "terraria:vanilla"
}

async fn ensure_persisted_port(inst: &mut PersistedInstance) -> Result<(), Status> {
    if !template_needs_port(&inst.template_id) {
        return Ok(());
    }

    let current = inst.params.get("port").map(|s| s.trim()).unwrap_or("");
    if !current.is_empty() && current != "0" {
        return Ok(());
    }

    let port = port_alloc::allocate_tcp_port(0)
        .map_err(|e| Status::internal(format!("failed to allocate port: {e}")))?;
    inst.params.insert("port".to_string(), port.to_string());
    save_instance(inst).await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct InstanceApi {
    manager: ProcessManager,
}

impl InstanceApi {
    pub fn new(manager: ProcessManager) -> Self {
        Self { manager }
    }
}

#[tonic::async_trait]
impl InstanceService for InstanceApi {
    async fn create(
        &self,
        request: Request<CreateInstanceRequest>,
    ) -> Result<Response<CreateInstanceResponse>, Status> {
        let req = request.into_inner();
        let instance_id = alloy_process::ProcessId::new().0;

        // Validate by applying params through templates logic.
        let params: BTreeMap<String, String> = req.params.into_iter().collect();
        let _ = crate::templates::apply_params(
            crate::templates::find_template(&req.template_id)
                .ok_or_else(|| Status::invalid_argument("unknown template_id"))?,
            &params,
        )
        .map_err(|e| Status::invalid_argument(e.to_string()))?;

        let display_name = if req.display_name.trim().is_empty() {
            None
        } else {
            Some(req.display_name)
        };

        let inst = PersistedInstance {
            instance_id: instance_id.clone(),
            template_id: req.template_id,
            params,
            display_name,
        };
        save_instance(&inst).await?;

        Ok(Response::new(CreateInstanceResponse {
            config: Some(inst.to_proto()),
        }))
    }

    async fn get(
        &self,
        request: Request<GetInstanceRequest>,
    ) -> Result<Response<GetInstanceResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;
        let inst = load_instance(&id).await?;

        let status = self
            .manager
            .get_status(&id)
            .await
            .map(crate::process_service::map_status);

        Ok(Response::new(GetInstanceResponse {
            info: Some(InstanceInfo {
                config: Some(inst.to_proto()),
                status,
            }),
        }))
    }

    async fn list(
        &self,
        _request: Request<ListInstancesRequest>,
    ) -> Result<Response<ListInstancesResponse>, Status> {
        let base = data_root().join(INSTANCES_DIR);
        tokio::fs::create_dir_all(&base)
            .await
            .map_err(|e| Status::internal(format!("failed to create instances dir: {e}")))?;

        let mut out = Vec::new();
        let mut rd = tokio::fs::read_dir(&base)
            .await
            .map_err(|e| Status::internal(format!("failed to read instances dir: {e}")))?;
        while let Some(de) = rd
            .next_entry()
            .await
            .map_err(|e| Status::internal(format!("failed to read instances entry: {e}")))?
        {
            let name = de.file_name().to_string_lossy().to_string();
            let cfg_path = base.join(&name).join("instance.json");
            if tokio::fs::metadata(&cfg_path).await.is_err() {
                continue;
            }

            let inst = match load_instance(&name).await {
                Ok(v) => v,
                Err(_) => continue,
            };

            let status = self
                .manager
                .get_status(&name)
                .await
                .map(crate::process_service::map_status);

            out.push(InstanceInfo {
                config: Some(inst.to_proto()),
                status,
            });
        }

        Ok(Response::new(ListInstancesResponse { instances: out }))
    }

    async fn start(
        &self,
        request: Request<StartInstanceRequest>,
    ) -> Result<Response<StartInstanceResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;
        let mut inst = load_instance(&id).await?;

        // If port was omitted/blank, assign once and persist.
        ensure_persisted_port(&mut inst).await?;

        let status = self
            .manager
            .start_from_template_with_process_id(&id, &inst.template_id, inst.params)
            .await
            .map_err(|e| Status::invalid_argument(e.to_string()))?;

        Ok(Response::new(StartInstanceResponse {
            status: Some(crate::process_service::map_status(status)),
        }))
    }

    async fn stop(
        &self,
        request: Request<StopInstanceRequest>,
    ) -> Result<Response<StopInstanceResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;

        let timeout = if req.timeout_ms == 0 {
            std::time::Duration::from_secs(30)
        } else {
            std::time::Duration::from_millis(req.timeout_ms as u64)
        };

        let status = self
            .manager
            .stop(&id, timeout)
            .await
            .map_err(|e| Status::not_found(e.to_string()))?;

        Ok(Response::new(StopInstanceResponse {
            status: Some(crate::process_service::map_status(status)),
        }))
    }

    async fn delete(
        &self,
        request: Request<DeleteInstanceRequest>,
    ) -> Result<Response<DeleteInstanceResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;

        // If running, refuse deletion.
        if let Some(st) = self.manager.get_status(&id).await
            && matches!(
                st.state,
                alloy_process::ProcessState::Running
                    | alloy_process::ProcessState::Starting
                    | alloy_process::ProcessState::Stopping
            )
        {
            return Err(Status::failed_precondition("instance is running"));
        }

        let dir = instance_dir(&id).map_err(Status::from)?;
        if tokio::fs::metadata(&dir).await.is_err() {
            return Err(Status::not_found("instance not found"));
        }

        tokio::fs::remove_dir_all(&dir)
            .await
            .map_err(|e| Status::internal(format!("failed to delete instance: {e}")))?;

        Ok(Response::new(DeleteInstanceResponse { ok: true }))
    }

    async fn delete_preview(
        &self,
        request: Request<DeleteInstancePreviewRequest>,
    ) -> Result<Response<DeleteInstancePreviewResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;

        // If running, refuse preview to avoid races and to force explicit stop first.
        if let Some(st) = self.manager.get_status(&id).await
            && matches!(
                st.state,
                alloy_process::ProcessState::Running
                    | alloy_process::ProcessState::Starting
                    | alloy_process::ProcessState::Stopping
            )
        {
            return Err(Status::failed_precondition("instance is running"));
        }

        let dir = instance_dir(&id).map_err(Status::from)?;
        if tokio::fs::metadata(&dir).await.is_err() {
            return Err(Status::not_found("instance not found"));
        }

        let size_bytes = tokio::task::spawn_blocking({
            let dir = dir.clone();
            move || -> u64 {
                fn walk(path: &std::path::Path) -> u64 {
                    let meta = match std::fs::symlink_metadata(path) {
                        Ok(m) => m,
                        Err(_) => return 0,
                    };
                    // Count symlink itself, but don't traverse outside.
                    if meta.file_type().is_symlink() {
                        return meta.len();
                    }
                    if meta.is_file() {
                        return meta.len();
                    }
                    if !meta.is_dir() {
                        return 0;
                    }
                    let mut sum = 0u64;
                    let rd = match std::fs::read_dir(path) {
                        Ok(v) => v,
                        Err(_) => return 0,
                    };
                    for e in rd.flatten() {
                        sum = sum.saturating_add(walk(&e.path()));
                    }
                    sum
                }
                walk(&dir)
            }
        })
        .await
        .unwrap_or(0);

        Ok(Response::new(DeleteInstancePreviewResponse {
            instance_id: id,
            path: dir.display().to_string(),
            size_bytes,
        }))
    }

    async fn update(
        &self,
        request: Request<UpdateInstanceRequest>,
    ) -> Result<Response<UpdateInstanceResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;

        // Refuse updates while running to avoid inconsistent config vs process.
        if let Some(st) = self.manager.get_status(&id).await
            && matches!(
                st.state,
                alloy_process::ProcessState::Running
                    | alloy_process::ProcessState::Starting
                    | alloy_process::ProcessState::Stopping
            )
        {
            return Err(Status::failed_precondition("instance is running"));
        }

        let mut inst = load_instance(&id).await?;
        inst.params = req.params.into_iter().collect();
        inst.display_name = if req.display_name.trim().is_empty() {
            None
        } else {
            Some(req.display_name)
        };

        // Validate by applying params through templates logic.
        let _ = crate::templates::apply_params(
            crate::templates::find_template(&inst.template_id)
                .ok_or_else(|| Status::invalid_argument("unknown template_id"))?,
            &inst.params,
        )
        .map_err(|e| Status::invalid_argument(e.to_string()))?;

        // If port was omitted/blank, assign once and persist.
        ensure_persisted_port(&mut inst).await?;

        save_instance(&inst).await?;

        Ok(Response::new(UpdateInstanceResponse {
            config: Some(inst.to_proto()),
        }))
    }
}

pub fn server(manager: ProcessManager) -> InstanceServiceServer<InstanceApi> {
    InstanceServiceServer::new(InstanceApi::new(manager))
}
