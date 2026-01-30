use std::path::{Component, Path, PathBuf};

use alloy_proto::agent_v1::filesystem_service_server::{
    FilesystemService, FilesystemServiceServer,
};
use alloy_proto::agent_v1::{
    DirEntry, ListDirRequest, ListDirResponse, ReadFileRequest, ReadFileResponse,
};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tonic::{Request, Response, Status};

use crate::minecraft;

const DEFAULT_READ_LIMIT: u64 = 64 * 1024;
const MAX_READ_LIMIT: u64 = 1024 * 1024;

#[derive(Debug, Default, Clone)]
pub struct FilesystemApi;

#[derive(Debug)]
enum FsPathError {
    Absolute,
    Traversal,
}

impl From<FsPathError> for Status {
    fn from(value: FsPathError) -> Self {
        match value {
            FsPathError::Absolute => Status::invalid_argument("path must be relative"),
            FsPathError::Traversal => Status::invalid_argument("path traversal is not allowed"),
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

#[tonic::async_trait]
impl FilesystemService for FilesystemApi {
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

        let mut entries = Vec::new();
        let mut rd = tokio::fs::read_dir(&dir)
            .await
            .map_err(|e| Status::internal(format!("failed to read dir: {e}")))?;
        while let Some(de) = rd
            .next_entry()
            .await
            .map_err(|e| Status::internal(format!("failed to read dir entry: {e}")))?
        {
            let name = de
                .file_name()
                .to_string_lossy()
                .to_string();
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
}

pub fn server() -> FilesystemServiceServer<FilesystemApi> {
    FilesystemServiceServer::new(FilesystemApi)
}
