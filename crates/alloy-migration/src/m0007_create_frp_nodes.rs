use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(FrpNodes::Table)
                    .if_not_exists()
                    .col(ColumnDef::new(FrpNodes::Id).uuid().not_null().primary_key())
                    .col(ColumnDef::new(FrpNodes::UserId).uuid().not_null())
                    .col(ColumnDef::new(FrpNodes::Name).string().not_null())
                    .col(ColumnDef::new(FrpNodes::Config).text().not_null())
                    .col(
                        ColumnDef::new(FrpNodes::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(FrpNodes::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .index(
                        Index::create()
                            .name("idx_frp_nodes_user_name_unique")
                            .table(FrpNodes::Table)
                            .col(FrpNodes::UserId)
                            .col(FrpNodes::Name)
                            .unique(),
                    )
                    .foreign_key(
                        ForeignKey::create()
                            .name("fk_frp_nodes_user")
                            .from(FrpNodes::Table, FrpNodes::UserId)
                            .to(Users::Table, Users::Id)
                            .on_delete(ForeignKeyAction::Cascade),
                    )
                    .to_owned(),
            )
            .await?;

        // sea-query emits `CONSTRAINT name (col)` for non-unique indexes when attached to
        // `CREATE TABLE`, which is invalid in Postgres. Create the index separately.
        manager
            .create_index(
                Index::create()
                    .name("idx_frp_nodes_user_id")
                    .table(FrpNodes::Table)
                    .col(FrpNodes::UserId)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_frp_nodes_user_id")
                    .table(FrpNodes::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(FrpNodes::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Users {
    Table,
    Id,
}

#[derive(DeriveIden)]
enum FrpNodes {
    Table,
    Id,
    UserId,
    Name,
    Config,
    CreatedAt,
    UpdatedAt,
}
