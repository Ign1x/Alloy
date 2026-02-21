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

const LONG_LINE_FORCE_FRAGMENT_THRESHOLD_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileIdentity {
    dev: u64,
    ino: u64,
}

#[cfg(unix)]
fn file_identity(meta: &std::fs::Metadata) -> Option<FileIdentity> {
    use std::os::unix::fs::MetadataExt;
    Some(FileIdentity {
        dev: meta.dev(),
        ino: meta.ino(),
    })
}

#[cfg(not(unix))]
fn file_identity(_meta: &std::fs::Metadata) -> Option<FileIdentity> {
    None
}

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
    ResumeFrom {
        offset: u64,
        file_id: Option<FileIdentity>,
    },
}

fn parse_cursor(cursor: &str) -> Result<CursorMode, &'static str> {
    let c = cursor.trim();
    if c.is_empty() || c == "0" || c.eq_ignore_ascii_case("tail") {
        return Ok(CursorMode::TailFromEnd);
    }

    if c.as_bytes().len() >= 3 && (c.starts_with("v2;") || c.starts_with("V2;")) {
        let mut offset: Option<u64> = None;
        let mut dev: Option<u64> = None;
        let mut ino: Option<u64> = None;

        for part in c.split(';').skip(1) {
            let part = part.trim();
            if part.is_empty() {
                continue;
            }
            let Some((k, v)) = part
                .split_once('=')
                .or_else(|| part.split_once(':'))
            else {
                continue;
            };
            let k = k.trim();
            let v = v.trim();
            match k {
                "offset" | "off" => {
                    offset = Some(v.parse::<u64>().map_err(|_| {
                        "invalid cursor; v2 offset must be an integer"
                    })?);
                }
                "dev" => {
                    dev = Some(v.parse::<u64>().map_err(|_| "invalid cursor; v2 dev must be an integer")?);
                }
                "ino" => {
                    ino = Some(v.parse::<u64>().map_err(|_| "invalid cursor; v2 ino must be an integer")?);
                }
                _ => {}
            }
        }

        let Some(offset) = offset else {
            return Err("invalid cursor; v2 cursor requires offset=<n>");
        };

        let file_id = dev.zip(ino).map(|(dev, ino)| FileIdentity { dev, ino });
        return Ok(CursorMode::ResumeFrom { offset, file_id });
    }

    let mut dev: Option<u64> = None;
    let mut ino: Option<u64> = None;

    for part in c.split(';') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        let Some((k, v)) = part
            .split_once('=')
            .or_else(|| part.split_once(':'))
        else {
            continue;
        };
        let k = k.trim();
        let v = v.trim();
        match k {
            "dev" => {
                dev = v.parse::<u64>().ok();
            }
            "ino" => {
                ino = v.parse::<u64>().ok();
            }
            _ => {}
        }
    }

    let raw = c
        .strip_prefix("offset:")
        .or_else(|| c.strip_prefix("resume:"))
        .unwrap_or(c);

    let digits = raw
        .as_bytes()
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .count();
    if digits == 0 {
        return Err(
            "invalid cursor; use empty/\"0\"/\"tail\" for end-tail mode or offset:<n> for resume mode",
        );
    }
    let offset = raw[..digits].parse::<u64>().map_err(|_| {
        "invalid cursor; use empty/\"0\"/\"tail\" for end-tail mode or offset:<n> for resume mode"
    })?;

    let file_id = dev.zip(ino).map(|(dev, ino)| FileIdentity { dev, ino });
    Ok(CursorMode::ResumeFrom { offset, file_id })
}

fn encode_cursor(offset: u64, file_id: Option<FileIdentity>) -> String {
    match file_id {
        Some(id) => format!(
            "v2;offset={offset};dev={dev};ino={ino}",
            dev = id.dev,
            ino = id.ino
        ),
        None => format!("offset:{offset}"),
    }
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
    if buf.is_empty() {
        return DecodedChunk::default();
    }

    let ends_with_newline = buf.last() == Some(&b'\n');
    let mut seen_newlines = 0usize;
    let mut start = 0usize;

    for (idx, b) in buf.iter().enumerate().rev() {
        if *b != b'\n' {
            continue;
        }
        seen_newlines += 1;

        let stop = if ends_with_newline {
            seen_newlines > max_lines
        } else {
            seen_newlines >= max_lines
        };
        if stop {
            start = idx + 1;
            break;
        }
    }

    let mut decoded = decode_chunk(&buf[start..], max_lines, true);
    decoded.bytes_consumed = buf.len();
    decoded
}

fn force_progress_on_long_line_resume(
    mut decoded: DecodedChunk,
    buf: &[u8],
    max_lines: usize,
    hit_window_cap: bool,
) -> DecodedChunk {
    if decoded.bytes_consumed > 0 || buf.is_empty() {
        return decoded;
    }

    let should_force = hit_window_cap || buf.len() >= LONG_LINE_FORCE_FRAGMENT_THRESHOLD_BYTES;
    if !should_force {
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
        let file_id = file_identity(&meta);
        let limit_bytes = clamp_u32(req.limit_bytes, MAX_LIMIT_BYTES, DEFAULT_LIMIT_BYTES) as u64;
        let max_lines = clamp_u32(req.max_lines, MAX_MAX_LINES, DEFAULT_MAX_LINES) as usize;

        let mode = parse_cursor(&req.cursor).map_err(Status::invalid_argument)?;

        let (mode, cursor) = match mode {
            CursorMode::TailFromEnd => (CursorMode::TailFromEnd, size.saturating_sub(limit_bytes)),
            CursorMode::ResumeFrom { offset, file_id: cursor_file_id } => {
                let id_mismatch = match (file_id, cursor_file_id) {
                    (Some(current), Some(expected)) => current != expected,
                    _ => false,
                };
                if id_mismatch || offset > size {
                    (CursorMode::TailFromEnd, size.saturating_sub(limit_bytes))
                } else {
                    (
                        CursorMode::ResumeFrom {
                            offset,
                            file_id: cursor_file_id,
                        },
                        offset,
                    )
                }
            }
        };

        let to_read = std::cmp::min(limit_bytes, size.saturating_sub(cursor)) as usize;
        if to_read == 0 {
            return Ok(Response::new(TailFileResponse {
                lines: Vec::new(),
                next_cursor: encode_cursor(cursor, file_id),
            }));
        }

        let mut f = tokio::fs::File::open(&path)
            .await
            .map_err(|e| Status::internal(format!("failed to open file: {e}")))?;
        f.seek(std::io::SeekFrom::Start(cursor))
            .await
            .map_err(|e| Status::internal(format!("failed to seek: {e}")))?;

        let mut buf = Vec::with_capacity(to_read);
        f.take(to_read as u64)
            .read_to_end(&mut buf)
            .await
            .map_err(|e| Status::internal(format!("failed to read: {e}")))?;

        let hit_window_cap =
            (buf.len() as u64) == limit_bytes && size.saturating_sub(cursor) >= limit_bytes;

        let mut decoded = match mode {
            CursorMode::TailFromEnd => decode_tail_snapshot(&buf, max_lines),
            CursorMode::ResumeFrom { .. } => decode_chunk(&buf, max_lines, false),
        };
        if matches!(mode, CursorMode::ResumeFrom { .. }) {
            decoded = force_progress_on_long_line_resume(decoded, &buf, max_lines, hit_window_cap);
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
            next_cursor: encode_cursor(next_cursor, file_id),
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

        assert_eq!(
            parse_cursor("42"),
            Ok(CursorMode::ResumeFrom {
                offset: 42,
                file_id: None
            })
        );
        assert_eq!(
            parse_cursor("offset:99"),
            Ok(CursorMode::ResumeFrom {
                offset: 99,
                file_id: None
            })
        );
        assert_eq!(
            parse_cursor("resume:7"),
            Ok(CursorMode::ResumeFrom {
                offset: 7,
                file_id: None
            })
        );
        assert_eq!(
            parse_cursor("offset:10;dev=1;ino=2"),
            Ok(CursorMode::ResumeFrom {
                offset: 10,
                file_id: Some(FileIdentity { dev: 1, ino: 2 })
            })
        );
        assert_eq!(
            parse_cursor("v2;offset=10;dev=1;ino=2"),
            Ok(CursorMode::ResumeFrom {
                offset: 10,
                file_id: Some(FileIdentity { dev: 1, ino: 2 })
            })
        );
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

        let progressed = force_progress_on_long_line_resume(decoded, b"verylongline", 10, true);
        assert_eq!(progressed.lines, vec!["verylongline".to_string()]);
        assert_eq!(progressed.bytes_consumed, b"verylongline".len());
    }

    #[test]
    fn encode_cursor_uses_offset_prefix_without_file_id() {
        assert_eq!(encode_cursor(123, None), "offset:123");
    }

    #[test]
    fn encode_cursor_includes_file_identity_when_available() {
        assert_eq!(
            encode_cursor(123, Some(FileIdentity { dev: 1, ino: 2 })),
            "v2;offset=123;dev=1;ino=2"
        );
    }
}
