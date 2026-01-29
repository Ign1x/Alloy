use std::{collections::BTreeMap, time::Duration};

use alloy_proto::agent_v1::process_service_server::{ProcessService, ProcessServiceServer};
use alloy_proto::agent_v1::{
    GetStatusRequest, GetStatusResponse, ListProcessesRequest, ListProcessesResponse,
    ListTemplatesRequest, ListTemplatesResponse, ProcessState, ProcessStatus, ProcessTemplate,
    StartFromTemplateRequest, StartFromTemplateResponse, StopProcessRequest, StopProcessResponse,
    TailLogsRequest, TailLogsResponse,
};
use tonic::{Request, Response, Status};

use crate::process_manager::ProcessManager;

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

fn map_status(s: alloy_process::ProcessStatus) -> ProcessStatus {
    ProcessStatus {
        process_id: s.id.0,
        template_id: s.template_id.0,
        state: map_state(s.state) as i32,
        pid: s.pid.unwrap_or_default(),
        has_pid: s.pid.is_some(),
        exit_code: s.exit_code.unwrap_or_default(),
        has_exit_code: s.exit_code.is_some(),
        message: s.message.unwrap_or_default(),
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
