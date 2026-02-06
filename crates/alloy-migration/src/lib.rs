use sea_orm_migration::prelude::*;

mod m0001_create_users;
mod m0002_create_nodes;
mod m0003_create_refresh_tokens;
mod m0004_create_audit_events;
mod m0005_add_node_connect_token;
mod m0006_create_settings;
mod m0007_create_frp_nodes;
mod m0008_add_frp_node_metadata;
mod m0009_create_download_jobs;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(m0001_create_users::Migration),
            Box::new(m0002_create_nodes::Migration),
            Box::new(m0003_create_refresh_tokens::Migration),
            Box::new(m0004_create_audit_events::Migration),
            Box::new(m0005_add_node_connect_token::Migration),
            Box::new(m0006_create_settings::Migration),
            Box::new(m0007_create_frp_nodes::Migration),
            Box::new(m0008_add_frp_node_metadata::Migration),
            Box::new(m0009_create_download_jobs::Migration),
        ]
    }
}
