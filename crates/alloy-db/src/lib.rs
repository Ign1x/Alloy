pub use sea_orm;

use sea_orm::{Database, DatabaseConnection};

pub mod entities;

pub async fn connect(database_url: &str) -> Result<DatabaseConnection, sea_orm::DbErr> {
    Database::connect(database_url).await
}
