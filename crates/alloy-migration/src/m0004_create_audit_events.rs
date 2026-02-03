use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(AuditEvents::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(AuditEvents::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(AuditEvents::RequestId).string().not_null())
                    .col(ColumnDef::new(AuditEvents::UserId).uuid().null())
                    .col(ColumnDef::new(AuditEvents::Action).string().not_null())
                    .col(ColumnDef::new(AuditEvents::Target).string().not_null())
                    .col(ColumnDef::new(AuditEvents::Meta).json_binary().null())
                    .col(
                        ColumnDef::new(AuditEvents::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        // Create indexes separately (Postgres does not support arbitrary index-like "CONSTRAINT (...)" clauses).
        manager
            .create_index(
                Index::create()
                    .name("idx_audit_events_created_at")
                    .table(AuditEvents::Table)
                    .col(AuditEvents::CreatedAt)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_audit_events_user_id")
                    .table(AuditEvents::Table)
                    .col(AuditEvents::UserId)
                    .if_not_exists()
                    .to_owned(),
            )
            .await?;

        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_table(Table::drop().table(AuditEvents::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum AuditEvents {
    Table,
    Id,
    RequestId,
    UserId,
    Action,
    Target,
    Meta,
    CreatedAt,
}
