use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Nodes::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(Nodes::Id).uuid().not_null().primary_key())
                    .col(ColumnDef::new(Nodes::Name).string().not_null())
                    .col(ColumnDef::new(Nodes::Endpoint).string().not_null())
                    .col(
                        ColumnDef::new(Nodes::Enabled)
                            .boolean()
                            .not_null()
                            .default(true),
                    )
                    .col(
                        ColumnDef::new(Nodes::LastSeenAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(ColumnDef::new(Nodes::AgentVersion).string().null())
                    .col(ColumnDef::new(Nodes::LastError).string().null())
                    .col(
                        ColumnDef::new(Nodes::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Nodes::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .index(
                        Index::create()
                            .name("idx_nodes_name_unique")
                            .table(Nodes::Table)
                            .col(Nodes::Name)
                            .unique(),
                    )
                    .index(
                        Index::create()
                            .name("idx_nodes_endpoint_unique")
                            .table(Nodes::Table)
                            .col(Nodes::Endpoint)
                            .unique(),
                    )
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(Nodes::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Nodes {
    Table,
    Id,
    Name,
    Endpoint,
    Enabled,
    LastSeenAt,
    AgentVersion,
    LastError,
    CreatedAt,
    UpdatedAt,
}
