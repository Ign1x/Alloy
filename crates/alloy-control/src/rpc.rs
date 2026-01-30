use alloy_proto::agent_v1::{
    ListDirRequest, ReadFileRequest,
    GetStatusRequest, HealthCheckRequest, ListProcessesRequest, ListTemplatesRequest,
    StartFromTemplateRequest, StopProcessRequest, TailLogsRequest,
    agent_health_service_client::AgentHealthServiceClient,
    filesystem_service_client::FilesystemServiceClient,
    process_service_client::ProcessServiceClient,
};
use rspc::{Procedure, ProcedureError, ResolverError, Router};
use tonic::Request;

use specta::Type;

// Request context for rspc procedures.
//
// No DB for the initial vertical slice; keep it empty until we need shared state
// (gRPC clients, config, auth/session, etc.).
#[derive(Clone, Debug, Default)]
pub struct Ctx;

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ApiError {
    pub message: String,
}

impl rspc::Error for ApiError {
    fn into_procedure_error(self) -> ProcedureError {
        // Keep error payload intentionally minimal/safe for frontend.
        ResolverError::new(self.message, Option::<std::io::Error>::None).into()
    }
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct PingResponse {
    pub status: String,
    pub version: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct AgentHealthResponse {
    pub status: String,
    pub agent_version: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessTemplateDto {
    pub template_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ProcessStatusDto {
    pub process_id: String,
    pub template_id: String,
    pub state: String,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub message: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct StartProcessInput {
    pub template_id: String,
    pub params: std::collections::BTreeMap<String, String>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct StopProcessInput {
    pub process_id: String,
    pub timeout_ms: Option<u32>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct GetStatusInput {
    pub process_id: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct TailLogsInput {
    pub process_id: String,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct TailLogsOutput {
    pub lines: Vec<String>,
    pub next_cursor: String,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct ListDirInput {
    pub path: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct DirEntryDto {
    pub name: String,
    pub is_dir: bool,
    pub size_bytes: u32,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ListDirOutput {
    pub entries: Vec<DirEntryDto>,
}

#[derive(Debug, Clone, serde::Deserialize, Type)]
pub struct ReadFileInput {
    pub path: String,
    pub offset: Option<u32>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, Type)]
pub struct ReadFileOutput {
    // For MVP: return as UTF-8 text (logs/config). Binary files are not supported yet.
    pub text: String,
    pub size_bytes: u32,
}

fn clamp_u64_to_u32(v: u64) -> u32 {
    if v > u32::MAX as u64 {
        u32::MAX
    } else {
        v as u32
    }
}

pub fn router() -> Router<Ctx> {
    // NOTE: Procedure keys are nested segments. This keeps generated `web/src/bindings.ts`
    // valid TypeScript (no unquoted keys with dots), while the runtime request path still
    // flattens to "segment.segment".
    let control = Router::new().procedure(
        "ping",
        Procedure::builder::<ApiError>().query(|_, _: ()| async move {
            Ok(PingResponse {
                status: "ok".to_string(),
                version: env!("CARGO_PKG_VERSION").to_string(),
            })
        }),
    );

    let agent = Router::new().procedure(
        "health",
        Procedure::builder::<ApiError>().query(|_, _: ()| async move {
            // Container-safe: do not hardcode localhost.
            //
            // Local dev default is http://127.0.0.1:50051.
            // In docker-compose, set ALLOY_AGENT_ENDPOINT=http://alloy-agent:50051.
            let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());

            let mut client = AgentHealthServiceClient::connect(agent_endpoint.clone())
                .await
                .map_err(|e| ApiError {
                    message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                })?;

            let resp = client
                .check(Request::new(HealthCheckRequest {}))
                .await
                .map_err(|e| ApiError {
                    message: format!("agent health check failed: {e}"),
                })?;

            let resp = resp.into_inner();
            Ok(AgentHealthResponse {
                status: resp.status,
                agent_version: resp.agent_version,
            })
        }),
    );

    let process = Router::new()
        .procedure(
            "templates",
            Procedure::builder::<ApiError>().query(|_, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let resp = client
                    .list_templates(Request::new(ListTemplatesRequest {}))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("list_templates failed: {e}"),
                    })?
                    .into_inner();

                Ok(resp
                    .templates
                    .into_iter()
                    .map(|t| ProcessTemplateDto {
                        template_id: t.template_id,
                        display_name: t.display_name,
                    })
                    .collect::<Vec<_>>())
            }),
        )
        .procedure(
            "list",
            Procedure::builder::<ApiError>().query(|_, _: ()| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let resp = client
                    .list_processes(Request::new(ListProcessesRequest {}))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("list_processes failed: {e}"),
                    })?
                    .into_inner();

                Ok(resp
                    .processes
                    .into_iter()
                    .map(|p| ProcessStatusDto {
                        process_id: p.process_id.clone(),
                        template_id: p.template_id.clone(),
                        state: p.state().as_str_name().to_string(),
                        pid: if p.has_pid { Some(p.pid) } else { None },
                        exit_code: if p.has_exit_code {
                            Some(p.exit_code)
                        } else {
                            None
                        },
                        message: if p.message.is_empty() {
                            None
                        } else {
                            Some(p.message)
                        },
                    })
                    .collect::<Vec<_>>())
            }),
        )
        .procedure(
            "start",
            Procedure::builder::<ApiError>().mutation(|_, input: StartProcessInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let req = StartFromTemplateRequest {
                    template_id: input.template_id,
                    params: input.params.into_iter().collect(),
                };

                let status = client
                    .start_from_template(Request::new(req))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("start_from_template failed: {e}"),
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| ApiError {
                        message: "missing status".to_string(),
                    })?;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "stop",
            Procedure::builder::<ApiError>().mutation(|_, input: StopProcessInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let req = StopProcessRequest {
                    process_id: input.process_id,
                    timeout_ms: input.timeout_ms.unwrap_or(30_000),
                };

                let status = client
                    .stop(Request::new(req))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("stop failed: {e}"),
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| ApiError {
                        message: "missing status".to_string(),
                    })?;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "status",
            Procedure::builder::<ApiError>().query(|_, input: GetStatusInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let status = client
                    .get_status(Request::new(GetStatusRequest {
                        process_id: input.process_id,
                    }))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("get_status failed: {e}"),
                    })?
                    .into_inner()
                    .status
                    .ok_or_else(|| ApiError {
                        message: "missing status".to_string(),
                    })?;

                Ok(ProcessStatusDto {
                    process_id: status.process_id.clone(),
                    template_id: status.template_id.clone(),
                    state: status.state().as_str_name().to_string(),
                    pid: if status.has_pid {
                        Some(status.pid)
                    } else {
                        None
                    },
                    exit_code: if status.has_exit_code {
                        Some(status.exit_code)
                    } else {
                        None
                    },
                    message: if status.message.is_empty() {
                        None
                    } else {
                        Some(status.message)
                    },
                })
            }),
        )
        .procedure(
            "logsTail",
            Procedure::builder::<ApiError>().query(|_, input: TailLogsInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = ProcessServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let resp = client
                    .tail_logs(Request::new(TailLogsRequest {
                        process_id: input.process_id,
                        limit: input.limit.unwrap_or(200),
                        cursor: input.cursor.unwrap_or_default(),
                    }))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("tail_logs failed: {e}"),
                    })?
                    .into_inner();

                Ok(TailLogsOutput {
                    lines: resp.lines,
                    next_cursor: resp.next_cursor,
                })
            }),
        );

    let fs = Router::new()
        .procedure(
            "listDir",
            Procedure::builder::<ApiError>().query(|_, input: ListDirInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = FilesystemServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let resp = client
                    .list_dir(Request::new(ListDirRequest {
                        path: input.path.unwrap_or_default(),
                    }))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("list_dir failed: {e}"),
                    })?
                    .into_inner();

                Ok(ListDirOutput {
                    entries: resp
                        .entries
                        .into_iter()
                        .map(|e| DirEntryDto {
                            name: e.name,
                            is_dir: e.is_dir,
                            size_bytes: clamp_u64_to_u32(e.size_bytes),
                        })
                        .collect(),
                })
            }),
        )
        .procedure(
            "readFile",
            Procedure::builder::<ApiError>().query(|_, input: ReadFileInput| async move {
                let agent_endpoint = std::env::var("ALLOY_AGENT_ENDPOINT")
                    .unwrap_or_else(|_| "http://127.0.0.1:50051".to_string());
                let mut client = FilesystemServiceClient::connect(agent_endpoint.clone())
                    .await
                    .map_err(|e| ApiError {
                        message: format!("failed to connect agent ({agent_endpoint}): {e}"),
                    })?;

                let resp = client
                    .read_file(Request::new(ReadFileRequest {
                        path: input.path,
                        offset: input.offset.unwrap_or(0) as u64,
                        limit: input.limit.unwrap_or(0) as u64,
                    }))
                    .await
                    .map_err(|e| ApiError {
                        message: format!("read_file failed: {e}"),
                    })?
                    .into_inner();

                let text = String::from_utf8(resp.data)
                    .map_err(|_| ApiError {
                        message: "file is not valid utf-8".to_string(),
                    })?;

                Ok(ReadFileOutput {
                    text,
                    size_bytes: clamp_u64_to_u32(resp.size_bytes),
                })
            }),
        );

    Router::new()
        .nest("control", control)
        .nest("agent", agent)
        .nest("process", process)
        .nest("fs", fs)
}
