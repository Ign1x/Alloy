use alloy_proto::agent_v1::{
    HealthCheckRequest, agent_health_service_client::AgentHealthServiceClient,
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
            // Local dev default: agent listens on :50051.
            // This will be made configurable via env/config later.
            let mut client = AgentHealthServiceClient::connect("http://127.0.0.1:50051")
                .await
                .map_err(|e| ApiError {
                    message: format!("failed to connect agent: {e}"),
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

    Router::new().nest("control", control).nest("agent", agent)
}
