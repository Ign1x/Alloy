use std::{
    collections::BTreeMap,
    net::IpAddr,
    path::{Component, Path, PathBuf},
    time::Duration,
};

use alloy_proto::agent_v1::instance_service_server::{InstanceService, InstanceServiceServer};
use alloy_proto::agent_v1::{
    CreateInstanceRequest, CreateInstanceResponse, DeleteInstancePreviewRequest,
    DeleteInstancePreviewResponse, DeleteInstanceRequest, DeleteInstanceResponse,
    GetInstanceRequest, GetInstanceResponse, ImportSaveFromPathRequest, ImportSaveFromUrlRequest,
    ImportSaveFromUrlResponse, InstanceConfig, InstanceInfo, ListInstancesRequest,
    ListInstancesResponse, StartInstanceRequest, StartInstanceResponse, StopInstanceRequest,
    StopInstanceResponse, UpdateInstanceRequest, UpdateInstanceResponse,
};
use futures_util::StreamExt;
use reqwest::Url;
use tokio::io::AsyncWriteExt;
use tonic::{Request, Response, Status};

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

async fn ensure_instance_stopped(
    manager: &ProcessManager,
    instance_id: &str,
) -> Result<(), Status> {
    if let Some(st) = manager.get_status(instance_id).await
        && matches!(
            st.state,
            alloy_process::ProcessState::Running
                | alloy_process::ProcessState::Starting
                | alloy_process::ProcessState::Stopping
        )
    {
        return Err(Status::failed_precondition(format!(
            "instance is running ({:?})",
            st.state
        )));
    }
    Ok(())
}

async fn ensure_persisted_ports(inst: &mut PersistedInstance) -> Result<(), Status> {
    if crate::game_adapters::ensure_adapter_ports(&inst.template_id, &mut inst.params)? {
        save_instance(inst).await?;
    }

    Ok(())
}

fn normalize_rel_path(rel: &str) -> Result<PathBuf, Status> {
    if rel.is_empty() {
        return Ok(PathBuf::new());
    }
    let p = Path::new(rel);
    if p.is_absolute() {
        return Err(Status::invalid_argument("path must be relative"));
    }

    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            Component::ParentDir => {
                return Err(Status::invalid_argument("path traversal is not allowed"));
            }
            Component::Prefix(_) | Component::RootDir => {
                return Err(Status::invalid_argument("path must be relative"));
            }
        }
    }
    Ok(out)
}

fn rel_to_data_root(path: &Path) -> String {
    let root = crate::minecraft::data_root();
    if let Ok(canon) = std::fs::canonicalize(path) {
        if let Ok(rel) = canon.strip_prefix(&root) {
            let s = rel.to_string_lossy().to_string();
            if !s.is_empty() {
                return s;
            }
        }
        return canon.to_string_lossy().to_string();
    }
    path.to_string_lossy().to_string()
}

fn minecraft_level_rel(instance_dir: &Path) -> PathBuf {
    let props_path = instance_dir.join("config").join("server.properties");
    let raw = std::fs::read_to_string(props_path).unwrap_or_default();
    for line in raw.lines() {
        let l = line.trim();
        if l.is_empty() || l.starts_with('#') {
            continue;
        }
        if let Some(rest) = l.strip_prefix("level-name=") {
            let v = rest.trim();
            if !v.is_empty() {
                return PathBuf::from(v);
            }
        }
    }
    PathBuf::from("worlds/world")
}

fn extract_zip_safely(zip_path: &Path, out_dir: &Path) -> anyhow::Result<()> {
    std::fs::create_dir_all(out_dir)?;
    let f = std::fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(f)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        let trimmed = name.trim_end_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        let rel = normalize_rel_path(trimmed)
            .map_err(|e| anyhow::anyhow!("invalid zip path {trimmed:?}: {e}"))?;
        if rel.as_os_str().is_empty() {
            continue;
        }

        let out_path = out_dir.join(&rel);
        if name.ends_with('/') {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let tmp_path = out_path.with_extension("tmp");
        let mut out = std::fs::File::create(&tmp_path)?;
        std::io::copy(&mut file, &mut out)?;
        out.sync_all().ok();
        std::fs::rename(&tmp_path, &out_path)?;
    }

    Ok(())
}

fn file_magic_is_zip(path: &Path) -> bool {
    use std::io::Read;

    let mut f = match std::fs::File::open(path) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let mut header = [0u8; 4];
    let n = match f.read(&mut header) {
        Ok(v) => v,
        Err(_) => return false,
    };
    if n < header.len() {
        return false;
    }

    matches!(
        header,
        [b'P', b'K', 0x03, 0x04]
            | [b'P', b'K', 0x05, 0x06]
            | [b'P', b'K', 0x07, 0x08]
            | [b'P', b'K', 0x01, 0x02]
    )
}

fn host_allowed_by_env_allowlist(host: &str) -> bool {
    let Some(raw) = std::env::var("ALLOY_IMPORT_URL_ALLOW_HOSTS").ok() else {
        return false;
    };

    let host_lc = host.to_ascii_lowercase();
    raw.split(',')
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .any(|allowed| allowed == "*" || allowed == host_lc)
}

fn ip_is_private_or_local(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_unspecified()
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_unique_local()
                || v6.is_unicast_link_local()
        }
    }
}

fn validate_import_url(url: &Url) -> Result<(), Status> {
    if url.scheme() != "http" && url.scheme() != "https" {
        return Err(Status::invalid_argument("url must be http(s)"));
    }

    let host = url
        .host_str()
        .ok_or_else(|| Status::invalid_argument("url host is required"))?;

    if host.eq_ignore_ascii_case("localhost") {
        return Err(Status::invalid_argument("url host is not allowed"));
    }

    if let Ok(ip) = host.parse::<IpAddr>()
        && ip_is_private_or_local(ip)
        && !host_allowed_by_env_allowlist(host)
    {
        return Err(Status::invalid_argument("url host is not allowed"));
    }

    Ok(())
}

fn find_single_file_by_suffix(root: &Path, suffix: &str) -> anyhow::Result<PathBuf> {
    fn walk(cur: &Path, suffix: &str, out: &mut Vec<PathBuf>) {
        let rd = match std::fs::read_dir(cur) {
            Ok(v) => v,
            Err(_) => return,
        };
        for e in rd.flatten() {
            let path = e.path();
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                walk(&path, suffix, out);
                continue;
            }
            if meta.is_file()
                && path
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(suffix)
            {
                out.push(path);
            }
        }
    }

    let mut matches = Vec::<PathBuf>::new();
    walk(root, suffix, &mut matches);
    if matches.is_empty() {
        anyhow::bail!("no {suffix} file found in archive");
    }
    if matches.len() > 1 {
        anyhow::bail!("multiple {suffix} files found in archive; provide a single save");
    }
    Ok(matches.remove(0))
}

fn find_minecraft_world_root(extracted_root: &Path) -> anyhow::Result<PathBuf> {
    fn walk(cur: &Path, hits: &mut Vec<PathBuf>) {
        let rd = match std::fs::read_dir(cur) {
            Ok(v) => v,
            Err(_) => return,
        };
        for e in rd.flatten() {
            let path = e.path();
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                walk(&path, hits);
                continue;
            }
            if meta.is_file()
                && path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case("level.dat"))
            {
                if let Some(parent) = path.parent() {
                    hits.push(parent.to_path_buf());
                }
            }
        }
    }

    let mut hits = Vec::<PathBuf>::new();
    walk(extracted_root, &mut hits);
    hits.sort();
    hits.dedup();
    if hits.is_empty() {
        anyhow::bail!("could not find level.dat in archive");
    }
    if hits.len() > 1 {
        anyhow::bail!("multiple Minecraft worlds found in archive; provide a single world");
    }
    Ok(hits.remove(0))
}

fn find_dst_cluster_root(extracted_root: &Path) -> anyhow::Result<PathBuf> {
    fn walk(cur: &Path, hits: &mut Vec<PathBuf>) {
        let rd = match std::fs::read_dir(cur) {
            Ok(v) => v,
            Err(_) => return,
        };
        for e in rd.flatten() {
            let path = e.path();
            let meta = match std::fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_dir() {
                walk(&path, hits);
                continue;
            }
            if meta.is_file()
                && path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .is_some_and(|n| n.eq_ignore_ascii_case("cluster.ini"))
                && let Some(parent) = path.parent()
            {
                if parent.join("Master").join("server.ini").is_file() {
                    hits.push(parent.to_path_buf());
                }
            }
        }
    }

    let mut hits = Vec::<PathBuf>::new();
    walk(extracted_root, &mut hits);
    hits.sort();
    hits.dedup();
    if hits.is_empty() {
        anyhow::bail!("could not find Cluster_1/cluster.ini in archive");
    }
    if hits.len() > 1 {
        anyhow::bail!("multiple DST clusters found in archive; provide a single Cluster_1");
    }
    Ok(hits.remove(0))
}

async fn install_save_from_downloaded(
    template_id: String,
    params: BTreeMap<String, String>,
    download_path: PathBuf,
    is_zip_hint: bool,
    imports_dir: PathBuf,
    instance_dir: PathBuf,
) -> Result<(String, PathBuf, Option<PathBuf>), Status> {
    tokio::task::spawn_blocking(
        move || -> Result<(String, PathBuf, Option<PathBuf>), Status> {
            let nonce = alloy_process::ProcessId::new().0;

            if template_id == "minecraft:vanilla"
                || template_id == "minecraft:modrinth"
                || template_id == "minecraft:import"
                || template_id == "minecraft:curseforge"
            {
                let is_zip = is_zip_hint || file_magic_is_zip(&download_path);
                if !is_zip {
                    return Err(Status::invalid_argument(
                        "minecraft save import expects a .zip world",
                    ));
                }

                let extracted_root = imports_dir.join(format!("extracted-{nonce}"));
                extract_zip_safely(&download_path, &extracted_root)
                    .map_err(|e| Status::invalid_argument(format!("failed to extract zip: {e}")))?;
                let world_root = find_minecraft_world_root(&extracted_root).map_err(|e| {
                    Status::invalid_argument(format!("invalid minecraft world: {e}"))
                })?;

                let level_rel = minecraft_level_rel(&instance_dir);
                let level_rel = normalize_rel_path(level_rel.to_string_lossy().as_ref())?;
                let target = instance_dir.join(&level_rel);
                let target_parent = target
                    .parent()
                    .ok_or_else(|| Status::invalid_argument("invalid level-name path"))?;
                std::fs::create_dir_all(target_parent)
                    .map_err(|e| Status::internal(format!("failed to create world parent: {e}")))?;

                let mut backup: Option<PathBuf> = None;
                if target.exists() {
                    let name = target
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("world");
                    let backup_path = target.with_file_name(format!("{name}_backup_{nonce}"));
                    std::fs::rename(&target, &backup_path).map_err(|e| {
                        Status::internal(format!("failed to backup existing world: {e}"))
                    })?;
                    backup = Some(backup_path);
                }

                std::fs::rename(&world_root, &target)
                    .map_err(|e| Status::internal(format!("failed to install world: {e}")))?;
                let _ = std::fs::remove_dir_all(&extracted_root);

                return Ok(("minecraft world imported".to_string(), target, backup));
            }

            if template_id == "terraria:vanilla" {
                let world_name = params
                    .get("world_name")
                    .map(|s| s.trim())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("world");
                let worlds_dir = instance_dir.join("worlds");
                std::fs::create_dir_all(&worlds_dir)
                    .map_err(|e| Status::internal(format!("failed to create worlds dir: {e}")))?;
                let target = worlds_dir.join(format!("{world_name}.wld"));

                let is_zip = is_zip_hint || file_magic_is_zip(&download_path);
                let source_wld = if is_zip {
                    let extracted_root = imports_dir.join(format!("extracted-{nonce}"));
                    extract_zip_safely(&download_path, &extracted_root).map_err(|e| {
                        Status::invalid_argument(format!("failed to extract zip: {e}"))
                    })?;
                    let wld = find_single_file_by_suffix(&extracted_root, ".wld").map_err(|e| {
                        Status::invalid_argument(format!("invalid terraria save: {e}"))
                    })?;
                    let staged = imports_dir.join(format!("staged-{nonce}.wld"));
                    let _ = std::fs::remove_file(&staged);
                    std::fs::rename(&wld, &staged)
                        .map_err(|e| Status::internal(format!("failed to stage world: {e}")))?;
                    let _ = std::fs::remove_dir_all(&extracted_root);
                    staged
                } else {
                    download_path.clone()
                };

                let mut backup: Option<PathBuf> = None;
                if target.exists() {
                    let backup_path = worlds_dir.join(format!("{world_name}.wld.backup_{nonce}"));
                    std::fs::rename(&target, &backup_path).map_err(|e| {
                        Status::internal(format!("failed to backup existing world: {e}"))
                    })?;
                    backup = Some(backup_path);
                }

                std::fs::rename(&source_wld, &target)
                    .map_err(|e| Status::internal(format!("failed to install world: {e}")))?;

                return Ok(("terraria world imported".to_string(), target, backup));
            }

            if template_id == "dst:vanilla" {
                let is_zip = is_zip_hint || file_magic_is_zip(&download_path);
                if !is_zip {
                    return Err(Status::invalid_argument(
                        "dst save import expects a .zip cluster (Cluster_1/)",
                    ));
                }

                let extracted_root = imports_dir.join(format!("extracted-{nonce}"));
                extract_zip_safely(&download_path, &extracted_root)
                    .map_err(|e| Status::invalid_argument(format!("failed to extract zip: {e}")))?;

                let cluster_root = find_dst_cluster_root(&extracted_root)
                    .map_err(|e| Status::invalid_argument(format!("invalid dst save: {e}")))?;

                let dst_root = instance_dir.join("klei").join("DoNotStarveTogether");
                std::fs::create_dir_all(&dst_root)
                    .map_err(|e| Status::internal(format!("failed to create dst root: {e}")))?;

                let target = dst_root.join("Cluster_1");
                let mut backup: Option<PathBuf> = None;
                if target.exists() {
                    let backup_path = dst_root.join(format!("Cluster_1_backup_{nonce}"));
                    std::fs::rename(&target, &backup_path).map_err(|e| {
                        Status::internal(format!("failed to backup existing cluster: {e}"))
                    })?;
                    backup = Some(backup_path);
                }

                std::fs::rename(&cluster_root, &target)
                    .map_err(|e| Status::internal(format!("failed to install cluster: {e}")))?;
                let _ = std::fs::remove_dir_all(&extracted_root);

                return Ok(("dst cluster imported".to_string(), target, backup));
            }

            Err(Status::unimplemented(
                "save import is not supported for this template",
            ))
        },
    )
    .await
    .map_err(|e| Status::internal(format!("import task failed: {e}")))?
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

        // If ports were omitted/blank, assign once and persist.
        ensure_persisted_ports(&mut inst).await?;

        let status = self
            .manager
            .start_from_template_with_process_id(&id, &inst.template_id, inst.params)
            .await
            .map_err(|e| Status::invalid_argument(e.to_string()))?;

        Ok(Response::new(StartInstanceResponse {
            status: Some(crate::process_service::map_status(status)),
        }))
    }

    async fn import_save_from_url(
        &self,
        request: Request<ImportSaveFromUrlRequest>,
    ) -> Result<Response<ImportSaveFromUrlResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;
        ensure_instance_stopped(&self.manager, &id).await?;

        let url_raw = req.url.trim();
        if url_raw.is_empty() {
            return Err(Status::invalid_argument("url is required"));
        }
        let url = Url::parse(url_raw).map_err(|_| Status::invalid_argument("invalid url"))?;
        validate_import_url(&url)?;

        let inst = load_instance(&id).await?;
        let instance_dir = instance_dir(&id).map_err(Status::from)?;
        tokio::fs::create_dir_all(&instance_dir)
            .await
            .map_err(|e| Status::internal(format!("failed to create instance dir: {e}")))?;
        let imports_dir = instance_dir.join("imports");
        tokio::fs::create_dir_all(&imports_dir)
            .await
            .map_err(|e| Status::internal(format!("failed to create imports dir: {e}")))?;

        let nonce = alloy_process::ProcessId::new().0;
        let leaf = url
            .path_segments()
            .and_then(|mut s| s.next_back())
            .unwrap_or("save");
        let leaf = leaf.trim();
        let safe_leaf = leaf
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                    c
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let is_zip_hint = safe_leaf.to_ascii_lowercase().ends_with(".zip");
        let download_name = if safe_leaf.is_empty() {
            format!("save-{nonce}.bin")
        } else {
            format!("save-{nonce}-{safe_leaf}")
        };
        let download_path = imports_dir.join(download_name);

        let client = reqwest::Client::builder()
            .user_agent("alloy-agent")
            .timeout(Duration::from_secs(30 * 60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|e| Status::internal(format!("failed to build http client: {e}")))?;
        let resp = client
            .get(url)
            .send()
            .await
            .map_err(|e| Status::unavailable(format!("download failed: {e}")))?;
        let resp = resp
            .error_for_status()
            .map_err(|e| Status::unavailable(format!("download failed: {e}")))?;

        let mut out = tokio::fs::File::create(&download_path)
            .await
            .map_err(|e| Status::internal(format!("failed to write download: {e}")))?;
        let mut total: u64 = 0;
        let mut stream = resp.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| Status::unavailable(format!("download failed: {e}")))?;
            total = total.saturating_add(chunk.len() as u64);
            // Hard safety limit: 2GiB.
            if total > 2 * 1024 * 1024 * 1024_u64 {
                let _ = tokio::fs::remove_file(&download_path).await;
                return Err(Status::invalid_argument("download too large"));
            }
            out.write_all(&chunk)
                .await
                .map_err(|e| Status::internal(format!("failed to write download: {e}")))?;
        }
        out.flush()
            .await
            .map_err(|e| Status::internal(format!("failed to flush download: {e}")))?;
        out.sync_all()
            .await
            .map_err(|e| Status::internal(format!("failed to sync download: {e}")))?;

        let res = install_save_from_downloaded(
            inst.template_id.clone(),
            inst.params.clone(),
            download_path.clone(),
            is_zip_hint,
            imports_dir,
            instance_dir,
        )
        .await?;

        // Best-effort cleanup: if we moved the file into place, download_path no longer exists.
        let _ = tokio::fs::remove_file(&download_path).await;

        let message = res.0;
        let installed = rel_to_data_root(&res.1);
        let backup = res
            .2
            .as_ref()
            .map(|p| rel_to_data_root(p))
            .unwrap_or_default();

        Ok(Response::new(ImportSaveFromUrlResponse {
            ok: true,
            message,
            installed_path: installed,
            backup_path: backup,
        }))
    }

    async fn import_save_from_path(
        &self,
        request: Request<ImportSaveFromPathRequest>,
    ) -> Result<Response<ImportSaveFromUrlResponse>, Status> {
        let req = request.into_inner();
        let id = normalize_instance_id(&req.instance_id).map_err(Status::from)?;
        ensure_instance_stopped(&self.manager, &id).await?;

        let rel = normalize_rel_path(req.path.trim())?;
        if rel.as_os_str().is_empty() {
            return Err(Status::invalid_argument("path is required"));
        }

        let source = data_root().join(&rel);
        let meta = tokio::fs::metadata(&source)
            .await
            .map_err(|_| Status::not_found("uploaded save not found"))?;
        if !meta.is_file() {
            return Err(Status::invalid_argument("path must be a file"));
        }

        let canonical = tokio::fs::canonicalize(&source)
            .await
            .map_err(|e| Status::internal(format!("failed to resolve upload path: {e}")))?;
        if !canonical.starts_with(data_root()) {
            return Err(Status::invalid_argument("path escapes data root"));
        }

        let inst = load_instance(&id).await?;
        let instance_dir = instance_dir(&id).map_err(Status::from)?;
        tokio::fs::create_dir_all(&instance_dir)
            .await
            .map_err(|e| Status::internal(format!("failed to create instance dir: {e}")))?;
        let imports_dir = instance_dir.join("imports");
        tokio::fs::create_dir_all(&imports_dir)
            .await
            .map_err(|e| Status::internal(format!("failed to create imports dir: {e}")))?;

        let is_zip_hint = rel.to_string_lossy().to_ascii_lowercase().ends_with(".zip");
        let res = install_save_from_downloaded(
            inst.template_id.clone(),
            inst.params.clone(),
            canonical.clone(),
            is_zip_hint,
            imports_dir,
            instance_dir,
        )
        .await?;

        let _ = tokio::fs::remove_file(&canonical).await;

        let message = res.0;
        let installed = rel_to_data_root(&res.1);
        let backup = res
            .2
            .as_ref()
            .map(|p| rel_to_data_root(p))
            .unwrap_or_default();

        Ok(Response::new(ImportSaveFromUrlResponse {
            ok: true,
            message,
            installed_path: installed,
            backup_path: backup,
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

        ensure_instance_stopped(&self.manager, &id).await?;

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
        ensure_instance_stopped(&self.manager, &id).await?;

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
        ensure_instance_stopped(&self.manager, &id).await?;

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

        // If ports were omitted/blank, assign once and persist.
        ensure_persisted_ports(&mut inst).await?;

        save_instance(&inst).await?;

        Ok(Response::new(UpdateInstanceResponse {
            config: Some(inst.to_proto()),
        }))
    }
}

pub fn server(manager: ProcessManager) -> InstanceServiceServer<InstanceApi> {
    InstanceServiceServer::new(InstanceApi::new(manager))
}
