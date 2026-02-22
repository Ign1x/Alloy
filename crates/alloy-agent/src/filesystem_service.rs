#![allow(
    clippy::result_large_err,
    clippy::manual_clamp,
    clippy::let_underscore_future
)]

use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

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

const DEFAULT_READ_LIMIT_BYTES: u64 = 64 * 1024;
const DEFAULT_READ_MAX_BYTES: u64 = 4 * 1024 * 1024;
const DEFAULT_WRITE_MAX_CHUNK_BYTES: usize = 4 * 1024 * 1024;
const HARD_MAX_IO_CHUNK_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Debug, Clone, Copy)]
struct FsLimits {
    read_default_bytes: u64,
    read_max_bytes: u64,
    write_max_chunk_bytes: usize,
}

#[derive(Debug, Clone, Copy)]
struct FsWritePolicy {
    atomic_on_truncate_start: bool,
    conflict_detection: bool,
    require_contiguous_offsets: bool,
}

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

fn status_from_io(op: &'static str, err: std::io::Error) -> Status {
    if is_symlink_nofollow_error(&err) {
        return Status::invalid_argument(format!("{op}: symlinks are not allowed"));
    }

    match err.kind() {
        std::io::ErrorKind::NotFound => Status::not_found(format!("{op}: not found")),
        std::io::ErrorKind::PermissionDenied => {
            Status::permission_denied(format!("{op}: permission denied"))
        }
        std::io::ErrorKind::InvalidInput => {
            Status::invalid_argument(format!("{op}: invalid input"))
        }
        std::io::ErrorKind::AlreadyExists => {
            Status::already_exists(format!("{op}: already exists"))
        }
        std::io::ErrorKind::NotADirectory | std::io::ErrorKind::IsADirectory => {
            Status::failed_precondition(format!("{op}: path type mismatch"))
        }
        std::io::ErrorKind::ReadOnlyFilesystem => {
            Status::failed_precondition(format!("{op}: filesystem is read-only"))
        }
        std::io::ErrorKind::CrossesDevices => {
            Status::failed_precondition(format!("{op}: cross-device operation is not supported"))
        }
        _ => Status::internal(format!("{op}: {err}")),
    }
}

#[cfg(unix)]
fn is_symlink_nofollow_error(err: &std::io::Error) -> bool {
    err.kind() == ErrorKind::Other && err.raw_os_error() == Some(libc::ELOOP)
}

#[cfg(not(unix))]
fn is_symlink_nofollow_error(_err: &std::io::Error) -> bool {
    false
}

#[cfg(unix)]
fn apply_open_nofollow(opt: &mut tokio::fs::OpenOptions) {
    opt.custom_flags(libc::O_NOFOLLOW);
}

#[cfg(not(unix))]
fn apply_open_nofollow(_opt: &mut tokio::fs::OpenOptions) {}

fn status_from_mkdir_io(err: std::io::Error) -> Status {
    match err.kind() {
        ErrorKind::NotFound => Status::not_found("mkdir failed: parent directory not found"),
        ErrorKind::PermissionDenied => Status::permission_denied("mkdir failed: permission denied"),
        ErrorKind::AlreadyExists => Status::already_exists("mkdir failed: path already exists"),
        ErrorKind::InvalidInput => Status::invalid_argument("mkdir failed: invalid input"),
        ErrorKind::NotADirectory => {
            Status::failed_precondition("mkdir failed: parent is not a directory")
        }
        ErrorKind::ReadOnlyFilesystem => {
            Status::failed_precondition("mkdir failed: filesystem is read-only")
        }
        _ => Status::internal(format!("mkdir failed: {err}")),
    }
}

fn status_from_rename_io(err: std::io::Error) -> Status {
    match err.kind() {
        ErrorKind::NotFound => Status::not_found("rename failed: source or parent not found"),
        ErrorKind::PermissionDenied => {
            Status::permission_denied("rename failed: permission denied")
        }
        ErrorKind::AlreadyExists => Status::already_exists("rename failed: target already exists"),
        ErrorKind::InvalidInput => Status::invalid_argument("rename failed: invalid input"),
        ErrorKind::NotADirectory | ErrorKind::IsADirectory => {
            Status::failed_precondition("rename failed: source/target type mismatch")
        }
        ErrorKind::CrossesDevices => {
            Status::failed_precondition("rename failed: cross-device move is not supported")
        }
        ErrorKind::ReadOnlyFilesystem => {
            Status::failed_precondition("rename failed: filesystem is read-only")
        }
        _ => Status::internal(format!("rename failed: {err}")),
    }
}

fn status_from_remove_io(err: std::io::Error) -> Status {
    match err.kind() {
        ErrorKind::NotFound => Status::not_found("remove failed: path not found"),
        ErrorKind::PermissionDenied => {
            Status::permission_denied("remove failed: permission denied")
        }
        ErrorKind::InvalidInput => Status::invalid_argument("remove failed: invalid input"),
        ErrorKind::DirectoryNotEmpty => {
            Status::failed_precondition("remove failed: directory not empty")
        }
        ErrorKind::NotADirectory | ErrorKind::IsADirectory => {
            Status::failed_precondition("remove failed: path type mismatch")
        }
        ErrorKind::ReadOnlyFilesystem => {
            Status::failed_precondition("remove failed: filesystem is read-only")
        }
        _ => Status::internal(format!("remove failed: {err}")),
    }
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<u64>().ok())
}

fn env_usize(name: &str) -> Option<usize> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<usize>().ok())
}

fn env_bool(name: &str, default_value: bool) -> bool {
    match std::env::var(name)
        .ok()
        .map(|v| v.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("1") | Some("true") | Some("yes") | Some("on") => true,
        Some("0") | Some("false") | Some("no") | Some("off") => false,
        _ => default_value,
    }
}

fn fs_limits() -> FsLimits {
    let read_max_bytes = env_u64("ALLOY_FS_READ_MAX_BYTES")
        .unwrap_or(DEFAULT_READ_MAX_BYTES)
        .max(1)
        .min(HARD_MAX_IO_CHUNK_BYTES);
    let read_default_bytes = env_u64("ALLOY_FS_READ_DEFAULT_BYTES")
        .unwrap_or(DEFAULT_READ_LIMIT_BYTES)
        .max(1)
        .min(read_max_bytes);
    let write_max_chunk_bytes = env_usize("ALLOY_FS_WRITE_MAX_CHUNK_BYTES")
        .unwrap_or(DEFAULT_WRITE_MAX_CHUNK_BYTES)
        .max(1)
        .min(HARD_MAX_IO_CHUNK_BYTES as usize);

    FsLimits {
        read_default_bytes,
        read_max_bytes,
        write_max_chunk_bytes,
    }
}

fn fs_write_policy() -> FsWritePolicy {
    FsWritePolicy {
        atomic_on_truncate_start: env_bool("ALLOY_FS_WRITE_ATOMIC_ON_TRUNCATE", true),
        conflict_detection: env_bool("ALLOY_FS_WRITE_CONFLICT_DETECTION", true),
        require_contiguous_offsets: env_bool("ALLOY_FS_WRITE_REQUIRE_CONTIGUOUS", false),
    }
}

fn log_io_error(op: &'static str, path: &Path, err: &std::io::Error) {
    tracing::warn!(
        operation = op,
        path = %path.display(),
        kind = ?err.kind(),
        error = %err,
        "filesystem io error"
    );
}

fn log_reject(op: &'static str, req_path: &str, reason: &'static str) {
    tracing::warn!(
        operation = op,
        path = req_path,
        reason,
        "filesystem request rejected"
    );
}

fn temp_write_path(path: &Path) -> PathBuf {
    let epoch_nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    path.with_extension(format!("tmp-{}-{epoch_nanos}", std::process::id()))
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

fn ensure_within_root(
    root: &Path,
    canon: &Path,
    op: &'static str,
    req_path: &str,
) -> Result<(), Status> {
    if canon.starts_with(root) {
        return Ok(());
    }

    tracing::warn!(
        operation = op,
        path = req_path,
        resolved = %canon.display(),
        root = %root.display(),
        "filesystem path escapes data root"
    );
    Err(Status::from(FsPathError::EscapesRoot))
}

async fn ensure_no_symlink_components(
    root: &Path,
    rel: &Path,
    req_path: &str,
    op: &'static str,
) -> Result<(), Status> {
    let mut cur = root.to_path_buf();
    for c in rel.components() {
        let seg = match c {
            Component::CurDir => continue,
            Component::Normal(s) => s,
            _ => return Err(Status::from(FsPathError::Traversal)),
        };
        cur.push(seg);

        match tokio::fs::symlink_metadata(&cur).await {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    log_reject(op, req_path, "symlink component is not allowed");
                    return Err(Status::invalid_argument("symlinks are not allowed in path"));
                }
            }
            Err(e) if e.kind() == ErrorKind::NotFound => break,
            Err(e) => {
                log_io_error(op, &cur, &e);
                return Err(status_from_io("failed to stat path", e));
            }
        }
    }
    Ok(())
}

async fn enforce_scoped_existing_path(rel_path: &str, op: &'static str) -> Result<PathBuf, Status> {
    let rel = normalize_rel_path(rel_path).map_err(Status::from)?;
    let root = data_root();

    ensure_no_symlink_components(&root, &rel, rel_path, op).await?;

    let scoped = root.join(&rel);
    let meta = tokio::fs::symlink_metadata(&scoped).await.map_err(|e| {
        log_io_error(op, &scoped, &e);
        status_from_io("failed to stat path", e)
    })?;
    if meta.file_type().is_symlink() {
        log_reject(op, rel_path, "symlink target is not allowed");
        return Err(Status::invalid_argument("symlinks are not allowed"));
    }

    let canon = tokio::fs::canonicalize(&scoped).await.map_err(|e| {
        log_io_error(op, &scoped, &e);
        status_from_io("failed to canonicalize path", e)
    })?;
    ensure_within_root(&root, &canon, op, rel_path)?;
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

async fn ensure_scoped_parent_dir(rel_path: &str, op: &'static str) -> Result<PathBuf, Status> {
    let rel = normalize_rel_path(rel_path).map_err(Status::from)?;
    let parent = rel.parent().unwrap_or(Path::new(""));
    let root = data_root();
    let parent_scoped = root.join(parent);

    ensure_no_symlink_components(&root, parent, rel_path, op).await?;

    let meta = tokio::fs::symlink_metadata(&parent_scoped)
        .await
        .map_err(|e| {
            log_io_error(op, &parent_scoped, &e);
            status_from_io("failed to stat parent directory", e)
        })?;
    if meta.file_type().is_symlink() {
        log_reject(op, rel_path, "parent directory is a symlink");
        return Err(Status::invalid_argument(
            "parent directory cannot be a symlink",
        ));
    }
    if !meta.is_dir() {
        return Err(Status::invalid_argument("parent is not a directory"));
    }

    let canon = tokio::fs::canonicalize(&parent_scoped).await.map_err(|e| {
        log_io_error(op, &parent_scoped, &e);
        status_from_io("failed to canonicalize parent directory", e)
    })?;
    ensure_within_root(&root, &canon, op, rel_path)?;
    Ok(canon)
}

async fn mkdir_rel(rel: &str, recursive: bool) -> Result<(), Status> {
    let req_path = rel;
    let rel = normalize_rel_path(rel).map_err(Status::from)?;
    let root = data_root();

    ensure_no_symlink_components(&root, &rel, req_path, "mkdir").await?;

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
                    log_reject("mkdir", req_path, "symlink component is not allowed");
                    return Err(Status::invalid_argument(
                        "symlinks are not allowed in mkdir path",
                    ));
                }
                if !m.is_dir() {
                    log_reject("mkdir", req_path, "path component is not a directory");
                    return Err(Status::failed_precondition(
                        "path component is not a directory",
                    ));
                }
            }
            Err(e) => {
                if e.kind() == ErrorKind::NotFound {
                    if recursive {
                        tokio::fs::create_dir(&next).await.map_err(|e| {
                            log_io_error("mkdir", &next, &e);
                            status_from_mkdir_io(e)
                        })?;
                    } else {
                        // If not recursive, only allow creating the leaf.
                        // Fail if any intermediate component is missing.
                        let is_leaf = next == root.join(&rel);
                        if !is_leaf {
                            return Err(Status::not_found("parent directory not found"));
                        }
                        tokio::fs::create_dir(&next).await.map_err(|e| {
                            log_io_error("mkdir", &next, &e);
                            status_from_mkdir_io(e)
                        })?;
                    }
                } else {
                    log_io_error("mkdir", &next, &e);
                    return Err(status_from_mkdir_io(e));
                }
            }
        }
        cur = next;
    }

    let canon = tokio::fs::canonicalize(&cur).await.map_err(|e| {
        log_io_error("mkdir", &cur, &e);
        Status::internal(format!("failed to canonicalize: {e}"))
    })?;
    ensure_within_root(&root, &canon, "mkdir", req_path)?;
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
        let dir = enforce_scoped_existing_path(&req.path, "list_dir").await?;

        let meta = tokio::fs::metadata(&dir).await.map_err(|e| {
            log_io_error("list_dir", &dir, &e);
            status_from_io("failed to stat path", e)
        })?;
        if !meta.is_dir() {
            return Err(Status::invalid_argument("path is not a directory"));
        }

        let mut entries = Vec::new();
        let mut rd = tokio::fs::read_dir(&dir).await.map_err(|e| {
            log_io_error("list_dir", &dir, &e);
            status_from_io("failed to read dir", e)
        })?;
        while let Some(de) = rd
            .next_entry()
            .await
            .map_err(|e| status_from_io("failed to read dir entry", e))?
        {
            let name = de.file_name().to_string_lossy().to_string();
            let ft = de
                .file_type()
                .await
                .map_err(|e| status_from_io("failed to stat dir entry", e))?;

            let m = if ft.is_symlink() {
                tokio::fs::symlink_metadata(de.path())
                    .await
                    .map_err(|e| status_from_io("failed to stat dir entry", e))?
            } else {
                de.metadata()
                    .await
                    .map_err(|e| status_from_io("failed to stat dir entry", e))?
            };
            let modified_unix_ms = m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| {
                    let ms = d.as_millis();
                    if ms > u64::MAX as u128 {
                        u64::MAX
                    } else {
                        ms as u64
                    }
                })
                .unwrap_or(0);
            entries.push(DirEntry {
                name,
                is_dir: if ft.is_symlink() { false } else { m.is_dir() },
                size_bytes: if ft.is_symlink() {
                    0
                } else if m.is_file() {
                    m.len()
                } else {
                    0
                },
                modified_unix_ms,
            });
        }

        entries.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(Response::new(ListDirResponse { entries }))
    }

    async fn read_file(
        &self,
        request: Request<ReadFileRequest>,
    ) -> Result<Response<ReadFileResponse>, Status> {
        let limits = fs_limits();
        let req = request.into_inner();
        let path = enforce_scoped_existing_path(&req.path, "read_file").await?;

        let meta = tokio::fs::metadata(&path).await.map_err(|e| {
            log_io_error("read_file", &path, &e);
            status_from_io("failed to stat path", e)
        })?;
        if !meta.is_file() {
            return Err(Status::invalid_argument("path is not a file"));
        }

        let size = meta.len();
        let offset = req.offset;
        if offset > size {
            return Err(Status::invalid_argument("offset out of range"));
        }

        let limit = if req.limit == 0 {
            limits.read_default_bytes
        } else {
            req.limit.min(limits.read_max_bytes)
        };

        let remaining = size - offset;
        let to_read = std::cmp::min(remaining, limit) as usize;

        let mut open = tokio::fs::OpenOptions::new();
        open.read(true);
        apply_open_nofollow(&mut open);
        let mut f = open.open(&path).await.map_err(|e| {
            log_io_error("read_file", &path, &e);
            status_from_io("failed to open file", e)
        })?;
        f.seek(std::io::SeekFrom::Start(offset))
            .await
            .map_err(|e| status_from_io("failed to seek", e))?;

        let mut buf = vec![0u8; to_read];
        if to_read > 0 {
            let mut read_total = 0usize;
            while read_total < to_read {
                let n = f
                    .read(&mut buf[read_total..])
                    .await
                    .map_err(|e| status_from_io("failed to read", e))?;
                if n == 0 {
                    break;
                }
                read_total = read_total.saturating_add(n);
            }
            buf.truncate(read_total);
        }

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
        let limits = fs_limits();
        let policy = fs_write_policy();
        let req = request.into_inner();
        if req.data.len() > limits.write_max_chunk_bytes {
            return Err(Status::invalid_argument(format!(
                "write chunk too large (max {} bytes)",
                limits.write_max_chunk_bytes
            )));
        }

        if req.truncate && req.offset != 0 {
            return Err(Status::failed_precondition(
                "write conflict: truncate writes must start at offset 0",
            ));
        }

        let parent = ensure_scoped_parent_dir(&req.path, "write_file").await?;
        let rel = normalize_rel_path(&req.path).map_err(Status::from)?;
        let file_name = rel
            .file_name()
            .ok_or_else(|| Status::invalid_argument("path must include filename"))?;
        let path = parent.join(file_name);

        let existing_meta = match tokio::fs::symlink_metadata(&path).await {
            Ok(m) => {
                if m.file_type().is_symlink() {
                    log_reject("write_file", &req.path, "target is a symlink");
                    return Err(Status::invalid_argument("refusing to write to symlink"));
                }
                if m.is_dir() {
                    log_reject("write_file", &req.path, "target is a directory");
                    return Err(Status::invalid_argument("path is a directory"));
                }
                Some(m)
            }
            Err(e) if e.kind() == ErrorKind::NotFound => None,
            Err(e) => {
                log_io_error("write_file", &path, &e);
                return Err(status_from_io("failed to stat path", e));
            }
        };

        if policy.conflict_detection && !req.truncate {
            match existing_meta.as_ref() {
                Some(meta) => {
                    let current_size = meta.len();
                    if req.offset > current_size {
                        return Err(Status::failed_precondition(
                            "write conflict: offset beyond current file size",
                        ));
                    }
                    if policy.require_contiguous_offsets && req.offset != current_size {
                        return Err(Status::failed_precondition(
                            "write conflict: expected contiguous chunk offset",
                        ));
                    }
                }
                None => {
                    if req.offset != 0 {
                        return Err(Status::failed_precondition(
                            "write conflict: file does not exist for non-zero offset",
                        ));
                    }
                }
            }
        }

        let atomic_replace = req.offset == 0 && req.truncate && policy.atomic_on_truncate_start;

        if atomic_replace {
            let mut tmp: Option<PathBuf> = None;
            for _ in 0..5 {
                let candidate = temp_write_path(&path);
                let open_res = tokio::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&candidate)
                    .await;
                match open_res {
                    Ok(mut f) => {
                        if let Err(e) = f.write_all(&req.data).await {
                            log_io_error("write_file", &candidate, &e);
                            let _ = tokio::fs::remove_file(&candidate).await;
                            return Err(status_from_io("failed to write", e));
                        }
                        if let Err(e) = f.flush().await {
                            log_io_error("write_file", &candidate, &e);
                            let _ = tokio::fs::remove_file(&candidate).await;
                            return Err(status_from_io("failed to flush", e));
                        }
                        drop(f);
                        tmp = Some(candidate);
                        break;
                    }
                    Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                    Err(e) => {
                        log_io_error("write_file", &candidate, &e);
                        return Err(status_from_io("failed to create temp file", e));
                    }
                }
            }

            let tmp = tmp
                .ok_or_else(|| Status::internal("failed to allocate temp file for atomic write"))?;

            if cfg!(windows) && existing_meta.is_some() {
                let mut backup: Option<PathBuf> = None;
                for _ in 0..5 {
                    let candidate = path.with_extension(format!(
                        "bak-{}-{}",
                        std::process::id(),
                        SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .map(|d| d.as_nanos())
                            .unwrap_or(0)
                    ));
                    match tokio::fs::rename(&path, &candidate).await {
                        Ok(_) => {
                            backup = Some(candidate);
                            break;
                        }
                        Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
                        Err(e) => {
                            log_io_error("write_file", &path, &e);
                            let _ = tokio::fs::remove_file(&tmp).await;
                            return Err(status_from_rename_io(e));
                        }
                    }
                }

                let backup = backup.ok_or_else(|| {
                    let _ = tokio::fs::remove_file(&tmp);
                    Status::internal("failed to allocate backup path for atomic write")
                })?;

                match tokio::fs::rename(&tmp, &path).await {
                    Ok(_) => {
                        let _ = tokio::fs::remove_file(&backup).await;
                        return Ok(Response::new(WriteFileResponse { ok: true }));
                    }
                    Err(e) => {
                        log_io_error("write_file", &path, &e);
                        let _ = tokio::fs::rename(&backup, &path).await;
                        let _ = tokio::fs::remove_file(&tmp).await;
                        return Err(status_from_rename_io(e));
                    }
                }
            }

            match tokio::fs::rename(&tmp, &path).await {
                Ok(_) => return Ok(Response::new(WriteFileResponse { ok: true })),
                Err(e) => {
                    log_io_error("write_file", &path, &e);
                    let _ = tokio::fs::remove_file(&tmp).await;
                    return Err(status_from_rename_io(e));
                }
            }
        }

        let mut open = tokio::fs::OpenOptions::new();
        open.write(true);

        let observed_existing_target = existing_meta.is_some();
        if !observed_existing_target {
            if policy.conflict_detection {
                open.create_new(true);
            } else {
                open.create(true);
            }
        }
        apply_open_nofollow(&mut open);

        let mut f = open.open(&path).await.map_err(|e| {
            log_io_error("write_file", &path, &e);
            if policy.conflict_detection {
                if existing_meta.is_some() && e.kind() == ErrorKind::NotFound {
                    return Status::failed_precondition("write conflict: target file disappeared");
                }
                if existing_meta.is_none() && e.kind() == ErrorKind::AlreadyExists {
                    return Status::failed_precondition("write conflict: target already exists");
                }
            }
            status_from_io("failed to open file", e)
        })?;

        if policy.conflict_detection && !req.truncate {
            let m = f.metadata().await.map_err(|e| {
                log_io_error("write_file", &path, &e);
                status_from_io("failed to stat open file", e)
            })?;
            let current_size = m.len();
            if req.offset > current_size {
                return Err(Status::failed_precondition(
                    "write conflict: offset beyond current file size",
                ));
            }
            if policy.require_contiguous_offsets && req.offset != current_size {
                return Err(Status::failed_precondition(
                    "write conflict: expected contiguous chunk offset",
                ));
            }
        }

        if req.truncate {
            f.set_len(0)
                .await
                .map_err(|e| status_from_io("failed to truncate", e))?;
        }

        f.seek(std::io::SeekFrom::Start(req.offset))
            .await
            .map_err(|e| status_from_io("failed to seek", e))?;
        f.write_all(&req.data)
            .await
            .map_err(|e| status_from_io("failed to write", e))?;
        f.flush()
            .await
            .map_err(|e| status_from_io("failed to flush", e))?;

        Ok(Response::new(WriteFileResponse { ok: true }))
    }

    async fn rename(
        &self,
        request: Request<RenameRequest>,
    ) -> Result<Response<RenameResponse>, Status> {
        ensure_fs_write_enabled()?;
        let req = request.into_inner();
        let from = enforce_scoped_existing_path(&req.from_path, "rename").await?;

        let to_parent = ensure_scoped_parent_dir(&req.to_path, "rename").await?;
        let to_rel = normalize_rel_path(&req.to_path).map_err(Status::from)?;
        let to_name = to_rel
            .file_name()
            .ok_or_else(|| Status::invalid_argument("to_path must include filename"))?;
        let to = to_parent.join(to_name);

        match tokio::fs::symlink_metadata(&to).await {
            Ok(meta) => {
                if meta.file_type().is_symlink() {
                    log_reject("rename", &req.to_path, "target is a symlink");
                    return Err(Status::invalid_argument("target cannot be a symlink"));
                }
                return Err(Status::already_exists("target already exists"));
            }
            Err(e) if e.kind() == ErrorKind::NotFound => {}
            Err(e) => {
                log_io_error("rename", &to, &e);
                return Err(status_from_rename_io(e));
            }
        }

        tokio::fs::rename(&from, &to).await.map_err(|e| {
            tracing::warn!(
                operation = "rename",
                from = %from.display(),
                to = %to.display(),
                kind = ?e.kind(),
                error = %e,
                "filesystem io error"
            );
            status_from_rename_io(e)
        })?;
        Ok(Response::new(RenameResponse { ok: true }))
    }

    async fn remove(
        &self,
        request: Request<RemoveRequest>,
    ) -> Result<Response<RemoveResponse>, Status> {
        ensure_fs_write_enabled()?;
        let req = request.into_inner();
        let path = enforce_scoped_existing_path(&req.path, "remove").await?;

        let meta = tokio::fs::symlink_metadata(&path).await.map_err(|e| {
            log_io_error("remove", &path, &e);
            status_from_remove_io(e)
        })?;
        if meta.file_type().is_symlink() {
            log_reject("remove", &req.path, "target is a symlink");
            return Err(Status::invalid_argument("refusing to remove symlink"));
        }

        if meta.is_dir() {
            if req.recursive {
                tokio::fs::remove_dir_all(&path).await.map_err(|e| {
                    log_io_error("remove", &path, &e);
                    status_from_remove_io(e)
                })?;
            } else {
                tokio::fs::remove_dir(&path).await.map_err(|e| {
                    log_io_error("remove", &path, &e);
                    status_from_remove_io(e)
                })?;
            }
        } else {
            tokio::fs::remove_file(&path).await.map_err(|e| {
                log_io_error("remove", &path, &e);
                status_from_remove_io(e)
            })?;
        }

        Ok(Response::new(RemoveResponse { ok: true }))
    }
}

pub fn server() -> FilesystemServiceServer<FilesystemApi> {
    FilesystemServiceServer::new(FilesystemApi)
}
