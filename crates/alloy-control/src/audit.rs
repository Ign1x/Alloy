use alloy_db::entities::audit_events;
use sea_orm::{ActiveModelTrait, Set};

use crate::rpc::Ctx;

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
