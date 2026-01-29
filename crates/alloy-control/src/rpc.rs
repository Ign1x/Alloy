use rspc::{Procedure, ProcedureError, ResolverError, Router};

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
    Router::new()
        .procedure(
            "control.ping",
            Procedure::builder::<ApiError>().query(|_, _: ()| async move {
                Ok(PingResponse {
                    status: "ok".to_string(),
                    version: env!("CARGO_PKG_VERSION").to_string(),
                })
            }),
        )
        .procedure(
            "agent.health",
            Procedure::builder::<ApiError>().query(|_, _: ()| async move {
                // Placeholder: wired to gRPC in the next atomic commit.
                Ok(AgentHealthResponse {
                    status: "UNKNOWN".to_string(),
                    agent_version: "".to_string(),
                })
            }),
        )
}
