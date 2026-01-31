use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(RefreshTokens::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(RefreshTokens::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(RefreshTokens::UserId).uuid().not_null())
                    .col(ColumnDef::new(RefreshTokens::TokenHash).string().not_null())
                    .col(
                        ColumnDef::new(RefreshTokens::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(ColumnDef::new(RefreshTokens::ExpiresAt).timestamp_with_time_zone().not_null())
                    .col(ColumnDef::new(RefreshTokens::RevokedAt).timestamp_with_time_zone().null())
                    .col(ColumnDef::new(RefreshTokens::RotatedAt).timestamp_with_time_zone().null())
                    .index(
                        Index::create()
                            .name("idx_refresh_tokens_token_hash_unique")
                            .table(RefreshTokens::Table)
                            .col(RefreshTokens::TokenHash)
                            .unique(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_refresh_tokens_user")
                            .from(RefreshTokens::Table, RefreshTokens::UserId)
                            .to(Users::Table, Users::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await
            ?;

        // sea-query emits `CONSTRAINT name (col)` for non-unique indexes when attached to
        // `CREATE TABLE`, which is invalid in Postgres. Create the index separately.
        manager
            .create_index(
                Index::create()
                    .name("idx_refresh_tokens_user_id")
                    .table(RefreshTokens::Table)
                    .col(RefreshTokens::UserId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_refresh_tokens_user_id")
                    .table(RefreshTokens::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(RefreshTokens::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum RefreshTokens {
    Table,
    Id,
    UserId,
    TokenHash,
    CreatedAt,
    ExpiresAt,
    RevokedAt,
    RotatedAt,
}
