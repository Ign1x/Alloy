use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(FrpNodes::Table)
                    .add_column(ColumnDef::new(FrpNodes::ServerAddr).string().null())
                    .add_column(ColumnDef::new(FrpNodes::ServerPort).integer().null())
                    .add_column(ColumnDef::new(FrpNodes::AllocatablePorts).text().null())
                    .add_column(ColumnDef::new(FrpNodes::Token).string().null())
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .alter_table(
                Table::alter()
                    .table(FrpNodes::Table)
                    .drop_column(FrpNodes::Token)
                    .drop_column(FrpNodes::AllocatablePorts)
                    .drop_column(FrpNodes::ServerPort)
                    .drop_column(FrpNodes::ServerAddr)
                    .to_owned(),
            )
            .await
    }
}

#[derive(DeriveIden)]
enum FrpNodes {
    Table,
    ServerAddr,
    ServerPort,
    AllocatablePorts,
    Token,
}
