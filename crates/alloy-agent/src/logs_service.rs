use std::path::{Component, Path, PathBuf};

use alloy_proto::agent_v1::logs_service_server::{LogsService, LogsServiceServer};
use alloy_proto::agent_v1::{TailFileRequest, TailFileResponse};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tonic::{Request, Response, Status};

use crate::minecraft;

const DEFAULT_LIMIT_BYTES: u32 = 64 * 1024;
const MAX_LIMIT_BYTES: u32 = 1024 * 1024;
const DEFAULT_MAX_LINES: u32 = 200;
const MAX_MAX_LINES: u32 = 2000;

#[derive(Debug)]
enum PathError {
    Absolute,
    Traversal,
}

impl From<PathError> for Status {
    fn from(value: PathError) -> Self {
        match value {
            PathError::Absolute => Status::invalid_argument("path must be relative"),
            PathError::Traversal => Status::invalid_argument("path traversal is not allowed"),
        }
    }
}

fn normalize_rel_path(rel: &str) -> Result<PathBuf, PathError> {
    if rel.is_empty() {
        return Ok(PathBuf::new());
    }

    let p = Path::new(rel);
    if p.is_absolute() {
        return Err(PathError::Absolute);
    }

    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            Component::ParentDir => return Err(PathError::Traversal),
            Component::Prefix(_) | Component::RootDir => return Err(PathError::Absolute),
        }
    }

    Ok(out)
}

fn scoped_path(rel: &str) -> Result<PathBuf, PathError> {
    let rel = normalize_rel_path(rel)?;
    Ok(minecraft::data_root().join(rel))
}

fn clamp_u32(v: u32, max: u32, default: u32) -> u32 {
    if v == 0 {
        return default;
    }
    v.min(max)
}

fn parse_cursor(cursor: &str) -> Result<u64, ()> {
    let c = cursor.trim();
    if c.is_empty() {
        return Ok(0);
    }
    c.parse::<u64>().map_err(|_| ())
}

fn split_lines_from_tail(buf: &[u8], max_lines: usize) -> Vec<String> {
    // Best-effort UTF-8: drop invalid sequences.
    let text = String::from_utf8_lossy(buf);
    let mut out: Vec<String> = text
        .lines()
        .map(|l| l.to_string())
        .collect();

    // Drop a trailing empty line if the file ends with a newline.
    if out.last().is_some_and(|l| l.is_empty()) {
        out.pop();
    }

    if out.len() > max_lines {
        out.drain(0..(out.len() - max_lines));
    }
    out
}

#[derive(Debug, Default, Clone)]
pub struct LogsApi;

#[tonic::async_trait]
impl LogsService for LogsApi {
    async fn tail_file(
        &self,
        request: Request<TailFileRequest>,
    ) -> Result<Response<TailFileResponse>, Status> {
        let req = request.into_inner();
        let path = scoped_path(&req.path).map_err(Status::from)?;

        let meta = tokio::fs::metadata(&path)
            .await
            .map_err(|_| Status::not_found("path not found"))?;
        if !meta.is_file() {
            return Err(Status::invalid_argument("path is not a file"));
        }

        let size = meta.len();
        let limit_bytes = clamp_u32(req.limit_bytes, MAX_LIMIT_BYTES, DEFAULT_LIMIT_BYTES) as u64;
        let max_lines = clamp_u32(req.max_lines, MAX_MAX_LINES, DEFAULT_MAX_LINES) as usize;

        // Cursor semantics:
        // - empty/"0": tail from end (bounded by limit_bytes)
        // - otherwise: treated as a byte offset to continue reading forward
        let mut cursor = parse_cursor(&req.cursor)
            .map_err(|_| Status::invalid_argument("invalid cursor"))?;
        if cursor == 0 {
            cursor = size.saturating_sub(limit_bytes);
        }
        if cursor > size {
            cursor = size;
        }

        let to_read = std::cmp::min(limit_bytes, size.saturating_sub(cursor)) as usize;

        let mut f = tokio::fs::File::open(&path)
            .await
            .map_err(|e| Status::internal(format!("failed to open file: {e}")))?;
        f.seek(std::io::SeekFrom::Start(cursor))
            .await
            .map_err(|e| Status::internal(format!("failed to seek: {e}")))?;

        let mut buf = vec![0u8; to_read];
        if to_read > 0 {
            f.read_exact(&mut buf)
                .await
                .map_err(|e| Status::internal(format!("failed to read: {e}")))?;
        }

        let lines = split_lines_from_tail(&buf, max_lines);
        let next_cursor = cursor + buf.len() as u64;

        Ok(Response::new(TailFileResponse {
            lines,
            next_cursor: next_cursor.to_string(),
        }))
    }
}

pub fn server() -> LogsServiceServer<LogsApi> {
    LogsServiceServer::new(LogsApi)
}
