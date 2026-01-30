use std::sync::Arc;

use alloy_db::sea_orm::DatabaseConnection;

#[derive(Clone)]
pub struct AppState {
    pub db: Arc<DatabaseConnection>,
}
