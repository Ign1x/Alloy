use std::path::{Component, Path, PathBuf};

use alloy_proto::agent_v1::filesystem_service_server::{
    FilesystemService, FilesystemServiceServer,
};
use alloy_proto::agent_v1::{
    DirEntry, GetCapabilitiesRequest, GetCapabilitiesResponse, ListDirRequest, ListDirResponse,
    MkdirRequest, MkdirResponse, ReadFileRequest, ReadFileResponse, RemoveRequest, RemoveResponse,
    RenameRequest, RenameResponse, WriteFileRequest, WriteFileResponse,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};
use tonic::{Request, Response, Status};

use crate::minecraft;

const DEFAULT_READ_LIMIT: u64 = 64 * 1024;
const MAX_READ_LIMIT: u64 = 1024 * 1024;
const MAX_WRITE_LIMIT: usize = 1024 * 1024;

#[derive(Debug, Default, Clone)]
pub struct FilesystemApi;

#[derive(Debug)]
enum FsPathError {
    Absolute,
    Traversal,
    EscapesRoot,
}

impl From<FsPathError> for Status {
    fn from(value: FsPathError) -> Self {
        match value {
            FsPathError::Absolute => Status::invalid_argument("path must be relative"),
            FsPathError::Traversal => Status::invalid_argument("path traversal is not allowed"),
            FsPathError::EscapesRoot => Status::invalid_argument("path escapes data root"),
        }
    }
}

fn normalize_rel_path(rel: &str) -> Result<PathBuf, FsPathError> {
    if rel.is_empty() {
        return Ok(PathBuf::new());
    }

    let p = Path::new(rel);
    if p.is_absolute() {
        return Err(FsPathError::Absolute);
    }

    // Keep it simple: deny parent traversal and any prefix component.
    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            Component::ParentDir => {
                return Err(FsPathError::Traversal);
            }
            Component::Prefix(_) | Component::RootDir => return Err(FsPathError::Absolute),
        }
    }

    Ok(out)
}

fn data_root() -> PathBuf {
    minecraft::data_root()
}

fn scoped_path(rel: &str) -> Result<PathBuf, FsPathError> {
    let rel = normalize_rel_path(rel)?;
    Ok(data_root().join(rel))
}

async fn enforce_scoped_existing_path(p: &Path) -> Result<PathBuf, Status> {
    let root = data_root();
    // canonicalize() resolves symlinks. This prevents escaping the data root via symlink chains.
    let canon = tokio::fs::canonicalize(p)
        .await
        .map_err(|_| Status::not_found("path not found"))?;
    if !canon.starts_with(&root) {
        return Err(Status::from(FsPathError::EscapesRoot));
    }
    Ok(canon)
}

fn fs_write_enabled() -> bool {
    matches!(
        std::env::var("ALLOY_FS_WRITE_ENABLED")
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn ensure_fs_write_enabled() -> Result<(), Status> {
    if !fs_write_enabled() {
        return Err(Status::failed_precondition(
            "filesystem write is disabled (set ALLOY_FS_WRITE_ENABLED=true to enable)",
        ));
    }
    Ok(())
}

async fn ensure_scoped_parent_dir(rel_path: &str) -> Result<PathBuf, Status> {
    let rel = normalize_rel_path(rel_path).map_err(Status::from)?;
    let parent = rel.parent().unwrap_or(Path::new(""));
    let parent_scoped = data_root().join(parent);

    let meta = tokio::fs::metadata(&parent_scoped)
        .await
        .map_err(|_| Status::not_found("parent directory not found"))?;
    if !meta.is_dir() {
        return Err(Status::invalid_argument("parent is not a directory"));
    }

    enforce_scoped_existing_path(&parent_scoped).await
}

async fn mkdir_rel(rel: &str, recursive: bool) -> Result<(), Status> {
    let rel = normalize_rel_path(rel).map_err(Status::from)?;
    let root = data_root();

    // Create directories step-by-step, refusing to traverse symlinks.
    let mut cur = root.clone();
    for c in rel.components() {
        let seg = match c {
            Component::Normal(s) => s,
            Component::CurDir => continue,
            _ => return Err(Status::from(FsPathError::Traversal)),
        };
        let next = cur.join(seg);
        match tokio::fs::symlink_metadata(&next).await {
            Ok(m) => {
                if m.file_type().is_symlink() {
                    return Err(Status::invalid_argument(
                        "symlinks are not allowed in mkdir path",
                    ));
                }
                if !m.is_dir() {
                    return Err(Status::invalid_argument(
                        "path component is not a directory",
                    ));
                }
            }
            Err(e) => {
                if e.kind() == std::io::ErrorKind::NotFound {
                    if recursive {
                        tokio::fs::create_dir(&next)
                            .await
                            .map_err(|e| Status::internal(format!("failed to create dir: {e}")))?;
                    } else {
                        // If not recursive, only allow creating the leaf.
                        // Fail if any intermediate component is missing.
                        let is_leaf = next == root.join(&rel);
                        if !is_leaf {
                            return Err(Status::not_found("parent directory not found"));
                        }
                        tokio::fs::create_dir(&next)
                            .await
                            .map_err(|e| Status::internal(format!("failed to create dir: {e}")))?;
                    }
                } else {
                    return Err(Status::internal(format!("failed to stat path: {e}")));
                }
            }
        }
        cur = next;
    }

    let canon = tokio::fs::canonicalize(&cur)
        .await
        .map_err(|e| Status::internal(format!("failed to canonicalize: {e}")))?;
    if !canon.starts_with(&root) {
        return Err(Status::from(FsPathError::EscapesRoot));
    }
    Ok(())
}

#[tonic::async_trait]
impl FilesystemService for FilesystemApi {
    async fn get_capabilities(
        &self,
        _request: Request<GetCapabilitiesRequest>,
    ) -> Result<Response<GetCapabilitiesResponse>, Status> {
        Ok(Response::new(GetCapabilitiesResponse {
            write_enabled: fs_write_enabled(),
        }))
    }

    async fn list_dir(
        &self,
        request: Request<ListDirRequest>,
    ) -> Result<Response<ListDirResponse>, Status> {
        let req = request.into_inner();
        let dir = scoped_path(&req.path).map_err(Status::from)?;

        let meta = tokio::fs::metadata(&dir)
            .await
            .map_err(|_| Status::not_found("path not found"))?;
        if !meta.is_dir() {
            return Err(Status::invalid_argument("path is not a directory"));
        }

        let dir = enforce_scoped_existing_path(&dir).await?;

        let mut entries = Vec::new();
        let mut rd = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| Status::internal(format!("failed to read dir: {e}")))?;
        while let Some(de) = rd
            .next_entry()
            .await
            .map_err(|e| Status::internal(format!("failed to read dir entry: {e}")))?
        {
            let name = de.file_name().to_string_lossy().to_string();
            let m = de
                .metadata()
                .await
                .map_err(|e| Status::internal(format!("failed to stat dir entry: {e}")))?;
            entries.push(DirEntry {
                name,
                is_dir: m.is_dir(),
                size_bytes: if m.is_file() { m.len() } else { 0 },
            });
        }

        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(Response::new(ListDirResponse { entries }))
    }

    async fn read_file(
        &self,
        request: Request<ReadFileRequest>,
    ) -> Result<Response<ReadFileResponse>, Status> {
        let req = request.into_inner();
        let path = scoped_path(&req.path).map_err(Status::from)?;

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|_| Status::not_found("path not found"))?;
        if !meta.is_file() {
            return Err(Status::invalid_argument("path is not a file"));
        }

        let path = enforce_scoped_existing_path(&path).await?;

        let size = meta.len();
        let offset = req.offset;
        if offset > size {
            return Err(Status::invalid_argument("offset out of range"));
        }

        let mut limit = req.limit;
        if limit == 0 {
            limit = DEFAULT_READ_LIMIT;
        }
        limit = limit.min(MAX_READ_LIMIT);

        let remaining = size - offset;
        let to_read = std::cmp::min(remaining, limit) as usize;

        let mut f = tokio::fs::File::open(&path)
            .await
            .map_err(|e| Status::internal(format!("failed to open file: {e}")))?;
        f.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| Status::internal(format!("failed to seek: {e}")))?;

        let mut buf = vec![0u8; to_read];
        f.read_exact(&mut buf)
            .await
            .map_err(|e| Status::internal(format!("failed to read: {e}")))?;

        Ok(Response::new(ReadFileResponse {
            data: buf,
            size_bytes: size,
        }))
    }

    async fn mkdir(
        &self,
        request: Request<MkdirRequest>,
    ) -> Result<Response<MkdirResponse>, Status> {
        ensure_fs_write_enabled()?;
        let req = request.into_inner();
        mkdir_rel(&req.path, req.recursive).await?;
        Ok(Response::new(MkdirResponse { ok: true }))
    }

    async fn write_file(
        &self,
        request: Request<WriteFileRequest>,
    ) -> Result<Response<WriteFileResponse>, Status> {
        ensure_fs_write_enabled()?;
        let req = request.into_inner();
        if req.data.len() > MAX_WRITE_LIMIT {
            return Err(Status::invalid_argument("file too large"));
        }

        let parent = ensure_scoped_parent_dir(&req.path).await?;
        let rel = normalize_rel_path(&req.path).map_err(Status::from)?;
        let file_name = rel
            .file_name()
            .ok_or_else(|| Status::invalid_argument("path must include filename"))?;
        let path = parent.join(file_name);

        let meta = tokio::fs::symlink_metadata(&path).await.ok();
        if let Some(m) = meta {
            if m.file_type().is_symlink() {
                return Err(Status::invalid_argument("refusing to write to symlink"));
            }
            if m.is_dir() {
                return Err(Status::invalid_argument("path is a directory"));
            }
        }

        let tmp = path.with_extension("tmp");
        let mut f = tokio::fs::File::create(&tmp)
            .await
            .map_err(|e| Status::internal(format!("failed to write temp file: {e}")))?;
        f.write_all(&req.data)
            .await
            .map_err(|e| Status::internal(format!("failed to write: {e}")))?;
        f.flush().await.ok();
        tokio::fs::rename(&tmp, &path)
            .await
            .map_err(|e| Status::internal(format!("failed to persist file: {e}")))?;

        Ok(Response::new(WriteFileResponse { ok: true }))
    }

    async fn rename(
        &self,
        request: Request<RenameRequest>,
    ) -> Result<Response<RenameResponse>, Status> {
        ensure_fs_write_enabled()?;
        let req = request.into_inner();
        let from = scoped_path(&req.from_path).map_err(Status::from)?;
        let from = enforce_scoped_existing_path(&from).await?;

        let to_parent = ensure_scoped_parent_dir(&req.to_path).await?;
        let to_rel = normalize_rel_path(&req.to_path).map_err(Status::from)?;
        let to_name = to_rel
            .file_name()
            .ok_or_else(|| Status::invalid_argument("to_path must include filename"))?;
        let to = to_parent.join(to_name);

        if tokio::fs::symlink_metadata(&to).await.is_ok() {
            return Err(Status::already_exists("target already exists"));
        }

        tokio::fs::rename(&from, &to)
            .await
            .map_err(|e| Status::internal(format!("rename failed: {e}")))?;
        Ok(Response::new(RenameResponse { ok: true }))
    }

    async fn remove(
        &self,
        request: Request<RemoveRequest>,
    ) -> Result<Response<RemoveResponse>, Status> {
        ensure_fs_write_enabled()?;
        let req = request.into_inner();
        let path = scoped_path(&req.path).map_err(Status::from)?;
        let path = enforce_scoped_existing_path(&path).await?;

        let meta = tokio::fs::symlink_metadata(&path)
            .await
            .map_err(|_| Status::not_found("path not found"))?;
        if meta.file_type().is_symlink() {
            return Err(Status::invalid_argument("refusing to remove symlink"));
        }

        if meta.is_dir() {
            if req.recursive {
                tokio::fs::remove_dir_all(&path)
                    .await
                    .map_err(|e| Status::internal(format!("remove failed: {e}")))?;
            } else {
                tokio::fs::remove_dir(&path)
                    .await
                    .map_err(|e| Status::internal(format!("remove failed: {e}")))?;
            }
        } else {
            tokio::fs::remove_file(&path)
                .await
                .map_err(|e| Status::internal(format!("remove failed: {e}")))?;
        }

        Ok(Response::new(RemoveResponse { ok: true }))
    }
}

pub fn server() -> FilesystemServiceServer<FilesystemApi> {
    FilesystemServiceServer::new(FilesystemApi)
}
