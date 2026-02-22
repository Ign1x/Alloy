use alloy_db::entities::audit_events;
use sea_orm::{ActiveModelTrait, Set};

use crate::request_meta::RequestMeta;
use crate::rpc::Ctx;

fn meta_request_fields(meta: &RequestMeta) -> serde_json::Value {
    serde_json::json!({
        "request_id": meta.request_id,
        "method": meta.method,
        "path": meta.path,
        "origin": meta.origin,
        "referer": meta.referer,
        "user_agent": meta.user_agent,
        "client_ip": meta.client_ip,
    })
}

pub async fn record_auth_failure(
    ctx: &Ctx,
    action: &str,
    target: &str,
    error_code: &str,
    error_source: &str,
    window_seconds: Option<i64>,
    meta: &RequestMeta,
) {
    record(
        ctx,
        action,
        target,
        Some(serde_json::json!({
            "error": {
                "code": error_code,
                "source": error_source,
                "window_seconds": window_seconds,
            },
            "request": meta_request_fields(meta),
        })),
    )
    .await;
}

pub async fn record(ctx: &Ctx, action: &str, target: &str, meta: Option<serde_json::Value>) {
    let user_id = ctx
        .user
        .as_ref()
        .and_then(|u| sea_orm::prelude::Uuid::parse_str(&u.user_id).ok());

    let model = audit_events::ActiveModel {
        id: Set(sea_orm::prelude::Uuid::new_v4()),
        request_id: Set(ctx.request_id.clone()),
        user_id: Set(user_id),
        action: Set(action.to_string()),
        target: Set(target.to_string()),
        meta: Set(meta),
        created_at: Set(chrono::Utc::now().into()),
    };

    if let Err(err) = model.insert(&*ctx.db).await {
        tracing::warn!(%err, action, target, "failed to write audit event");
    }
}
