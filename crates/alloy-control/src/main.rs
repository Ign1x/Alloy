use std::net::SocketAddr;

use alloy_control::rpc;
use axum::{Json, Router, routing::get};
use serde::Serialize;

#[derive(Debug, Serialize)]
struct HealthzResponse {
    status: &'static str,
    version: &'static str,
}

async fn healthz() -> Json<HealthzResponse> {
    Json(HealthzResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let router = rpc::router();
    let (procedures, _types) = router
        .build()
        .map_err(|errs| anyhow::anyhow!("rspc build failed: {errs:?}"))?;

    let app = Router::new()
        .route("/healthz", get(healthz))
        .nest("/rspc", rspc_axum::endpoint(procedures, || rpc::Ctx));
    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!(%addr, "alloy-control HTTP listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
