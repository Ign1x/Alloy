use std::net::SocketAddr;

use alloy_control::auth;
use alloy_control::node_health::NodeHealthPoller;
use alloy_control::rpc;
use alloy_control::security;
use alloy_control::state::AppState;
use axum::middleware;
use axum::{
    Json, Router,
    routing::{get, post},
};
use sea_orm::EntityTrait;
use sea_orm_migration::MigratorTrait;
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

async fn init_db_and_migrate() -> anyhow::Result<AppState> {
    let database_url =
        std::env::var("DATABASE_URL").map_err(|_| anyhow::anyhow!("DATABASE_URL is required"))?;
    let db = alloy_db::connect(&database_url).await?;

    // Apply migrations on boot (idempotent).
    alloy_migration::Migrator::up(&db, None).await?;

    // Ensure the default node exists so the UI has something to show.
    // This is idempotent and safe to run on every boot.
    if let Ok(endpoint) = std::env::var("ALLOY_AGENT_ENDPOINT") {
        let _ = alloy_db::entities::nodes::Entity::insert(alloy_db::entities::nodes::ActiveModel {
            id: sea_orm::Set(sea_orm::prelude::Uuid::new_v4()),
            name: sea_orm::Set("default".to_string()),
            endpoint: sea_orm::Set(endpoint),
            enabled: sea_orm::Set(true),
            last_seen_at: sea_orm::Set(None),
            agent_version: sea_orm::Set(None),
            last_error: sea_orm::Set(None),
            created_at: sea_orm::Set(chrono::Utc::now().into()),
            updated_at: sea_orm::Set(chrono::Utc::now().into()),
        })
        .on_conflict(
            sea_orm::sea_query::OnConflict::columns([alloy_db::entities::nodes::Column::Name])
                .do_nothing()
                .to_owned(),
        )
        .exec(&db)
        .await;
    }

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

    NodeHealthPoller::new(state.db.clone()).spawn();

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

    // Protect /rspc procedures with JWT cookie; allowlist health procedures.
    let rspc_router = rspc_axum::endpoint(
        procedures,
        |axum::extract::State(state): axum::extract::State<AppState>,
         user: Option<axum::Extension<rpc::AuthUser>>| {
            rpc::Ctx {
                db: state.db.clone(),
                user: user.map(|axum::Extension(u)| u),
            }
        },
    )
    .layer(middleware::from_fn(security::rspc_auth_guard));

    let app = Router::new()
        .route("/healthz", get(healthz))
        .route("/auth/whoami", get(auth::whoami))
        .nest("/auth", auth_router)
        .nest("/rspc", rspc_router)
        .with_state(state);
    let addr: SocketAddr = ([0, 0, 0, 0], 8080).into();
    tracing::info!(%addr, "alloy-control HTTP listening");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
