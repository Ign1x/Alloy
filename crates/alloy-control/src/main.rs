use std::net::SocketAddr;

use alloy_control::rpc;
use alloy_control::state::AppState;
use alloy_control::auth;
use alloy_control::security;
use axum::{Json, Router, routing::{get, post}};
use axum::middleware;
use serde::Serialize;
use sea_orm_migration::MigratorTrait;

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

async fn init_db_and_migrate() -> anyhow::Result<AppState> {
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let db = alloy_db::connect(&database_url).await?;

    // Apply migrations on boot (idempotent).
    alloy_migration::Migrator::up(&db, None).await?;

    Ok(AppState {
        db: std::sync::Arc::new(db),
    })
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let state = init_db_and_migrate().await?;

    let router = rpc::router();
    let (procedures, _types) = router
        .build()
        .map_err(|errs| anyhow::anyhow!("rspc build failed: {errs:?}"))?;

    // State-changing auth routes are protected by CSRF double-submit + Origin allowlist.
    let auth_router = Router::new()
        .route("/csrf", get(auth::csrf))
        .route("/login", post(auth::login))
        .route("/refresh", post(auth::refresh))
        .route("/logout", post(auth::logout))
        .layer(middleware::from_fn(security::csrf_and_origin))
        .with_state(state.clone());

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/whoami", get(auth::whoami))
        .nest("/auth", auth_router)
        .nest("/rspc", rspc_axum::endpoint(procedures, || rpc::Ctx))
        .with_state(state);
    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!(%addr, "alloy-control HTTP listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
