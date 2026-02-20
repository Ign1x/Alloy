use std::path::{Component, Path, PathBuf};

use alloy_proto::agent_v1::logs_service_server::{LogsService, LogsServiceServer};
use alloy_proto::agent_v1::{TailFileRequest, TailFileResponse};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tonic::{Request, Response, Status};
use tracing::debug;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CursorMode {
    TailFromEnd,
    ResumeFrom(u64),
}

fn parse_cursor(cursor: &str) -> Result<CursorMode, &'static str> {
    let c = cursor.trim();
    if c.is_empty() || c == "0" || c.eq_ignore_ascii_case("tail") {
        return Ok(CursorMode::TailFromEnd);
    }

    if let Some(raw) = c
        .strip_prefix("offset:")
        .or_else(|| c.strip_prefix("resume:"))
    {
        let offset = raw.parse::<u64>().map_err(|_| {
            "invalid cursor; use empty/\"0\"/\"tail\" for end-tail mode or offset:<n> for resume mode"
        })?;
        return Ok(CursorMode::ResumeFrom(offset));
    }

    let offset = c.parse::<u64>().map_err(|_| {
        "invalid cursor; use empty/\"0\"/\"tail\" for end-tail mode or offset:<n> for resume mode"
    })?;
    Ok(CursorMode::ResumeFrom(offset))
}

fn encode_cursor(offset: u64) -> String {
    format!("offset:{offset}")
}

#[derive(Debug, Default)]
struct DecodedChunk {
    lines: Vec<String>,
    bytes_consumed: usize,
    had_non_utf8: bool,
}

fn decode_line_lossy(line: &[u8]) -> (String, bool) {
    let line = if line.last() == Some(&b'\r') {
        &line[..line.len() - 1]
    } else {
        line
    };
    let decoded = String::from_utf8_lossy(line);
    let had_non_utf8 = matches!(decoded, std::borrow::Cow::Owned(_));
    (decoded.into_owned(), had_non_utf8)
}

fn decode_chunk(buf: &[u8], max_lines: usize, include_trailing_partial: bool) -> DecodedChunk {
    if buf.is_empty() {
        return DecodedChunk::default();
    }

    let mut out = Vec::new();
    let mut start = 0usize;
    let mut consumed = 0usize;
    let mut had_non_utf8 = false;

    for (idx, b) in buf.iter().enumerate() {
        if *b != b'\n' {
            continue;
        }

        let (line, lossy) = decode_line_lossy(&buf[start..idx]);
        had_non_utf8 |= lossy;
        out.push(line);
        consumed = idx + 1;
        start = idx + 1;

        if out.len() >= max_lines {
            return DecodedChunk {
                lines: out,
                bytes_consumed: consumed,
                had_non_utf8,
            };
        }
    }

    if include_trailing_partial && start < buf.len() && out.len() < max_lines {
        let (line, lossy) = decode_line_lossy(&buf[start..]);
        had_non_utf8 |= lossy;
        out.push(line);
        consumed = buf.len();
    }

    DecodedChunk {
        lines: out,
        bytes_consumed: consumed,
        had_non_utf8,
    }
}

fn decode_tail_snapshot(buf: &[u8], max_lines: usize) -> DecodedChunk {
    let mut decoded = decode_chunk(buf, usize::MAX, true);
    if decoded.lines.len() > max_lines {
        decoded
            .lines
            .drain(0..(decoded.lines.len().saturating_sub(max_lines)));
    }
    decoded.bytes_consumed = buf.len();
    decoded
}

fn force_progress_on_capped_resume(
    mut decoded: DecodedChunk,
    buf: &[u8],
    max_lines: usize,
    hit_window_cap: bool,
) -> DecodedChunk {
    if decoded.bytes_consumed > 0 || buf.is_empty() || !hit_window_cap {
        return decoded;
    }

    let (fragment, lossy) = decode_line_lossy(buf);
    decoded.lines = if max_lines > 0 {
        vec![fragment]
    } else {
        Vec::new()
    };
    decoded.bytes_consumed = buf.len();
    decoded.had_non_utf8 |= lossy;
    decoded
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

        let mode = parse_cursor(&req.cursor).map_err(Status::invalid_argument)?;

        let cursor = match mode {
            CursorMode::TailFromEnd => size.saturating_sub(limit_bytes),
            CursorMode::ResumeFrom(offset) => {
                if offset > size {
                    return Err(Status::failed_precondition(
                        "cursor out of range; log may have rotated/truncated, retry with cursor \"0\" or \"tail\"",
                    ));
                }
                offset
            }
        };

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

        let hit_window_cap =
            (buf.len() as u64) == limit_bytes && size.saturating_sub(cursor) >= limit_bytes;

        let mut decoded = match mode {
            CursorMode::TailFromEnd => decode_tail_snapshot(&buf, max_lines),
            CursorMode::ResumeFrom(_) => decode_chunk(&buf, max_lines, false),
        };
        if matches!(mode, CursorMode::ResumeFrom(_)) {
            decoded = force_progress_on_capped_resume(decoded, &buf, max_lines, hit_window_cap);
        }
        if decoded.had_non_utf8 {
            debug!(
                path = %path.display(),
                start_offset = cursor,
                consumed_bytes = decoded.bytes_consumed,
                "tail_file decoded non-utf8 log bytes with lossy fallback"
            );
        }

        let next_cursor = cursor + decoded.bytes_consumed as u64;

        Ok(Response::new(TailFileResponse {
            lines: decoded.lines,
            next_cursor: encode_cursor(next_cursor),
        }))
    }
}

pub fn server() -> LogsServiceServer<LogsApi> {
    LogsServiceServer::new(LogsApi)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_cursor_supports_dual_modes() {
        assert_eq!(parse_cursor(""), Ok(CursorMode::TailFromEnd));
        assert_eq!(parse_cursor("0"), Ok(CursorMode::TailFromEnd));
        assert_eq!(parse_cursor("tail"), Ok(CursorMode::TailFromEnd));

        assert_eq!(parse_cursor("42"), Ok(CursorMode::ResumeFrom(42)));
        assert_eq!(parse_cursor("offset:99"), Ok(CursorMode::ResumeFrom(99)));
        assert_eq!(parse_cursor("resume:7"), Ok(CursorMode::ResumeFrom(7)));
        assert!(parse_cursor("offset:nope").is_err());
    }

    #[test]
    fn incremental_decode_stops_on_line_limit() {
        let decoded = decode_chunk(b"a\nb\nc\n", 2, false);
        assert_eq!(decoded.lines, vec!["a".to_string(), "b".to_string()]);
        assert_eq!(decoded.bytes_consumed, 4);
    }

    #[test]
    fn incremental_decode_waits_for_newline_before_advancing_cursor() {
        let decoded = decode_chunk(b"partial-line", 10, false);
        assert!(decoded.lines.is_empty());
        assert_eq!(decoded.bytes_consumed, 0);
    }

    #[test]
    fn tail_snapshot_keeps_latest_lines() {
        let decoded = decode_tail_snapshot(b"a\nb\nc\n", 2);
        assert_eq!(decoded.lines, vec!["b".to_string(), "c".to_string()]);
        assert_eq!(decoded.bytes_consumed, 6);
    }

    #[test]
    fn decode_marks_non_utf8_lossy() {
        let decoded = decode_chunk(&[b'f', b'o', 0x80, b'\n'], 10, false);
        assert_eq!(decoded.lines, vec!["fo\u{fffd}".to_string()]);
        assert!(decoded.had_non_utf8);
    }

    #[test]
    fn force_progress_on_capped_resume_emits_fragment() {
        let decoded = decode_chunk(b"verylongline", 10, false);
        assert_eq!(decoded.bytes_consumed, 0);

        let progressed = force_progress_on_capped_resume(decoded, b"verylongline", 10, true);
        assert_eq!(progressed.lines, vec!["verylongline".to_string()]);
        assert_eq!(progressed.bytes_consumed, b"verylongline".len());
    }

    #[test]
    fn encode_cursor_uses_offset_prefix() {
        assert_eq!(encode_cursor(123), "offset:123");
    }
}
