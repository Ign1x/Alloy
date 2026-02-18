use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(Instances::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(Instances::InstanceId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(Instances::TemplateId).string().not_null())
                    .col(ColumnDef::new(Instances::ParamsJson).text().not_null())
                    .col(ColumnDef::new(Instances::DisplayName).string().null())
                    .col(ColumnDef::new(Instances::NodeId).uuid().null())
                    .col(ColumnDef::new(Instances::NodeName).string().not_null())
                    .col(
                        ColumnDef::new(Instances::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(Instances::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_instances_node_id")
                    .table(Instances::Table)
                    .col(Instances::NodeId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_instances_node_name")
                    .table(Instances::Table)
                    .col(Instances::NodeName)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_instances_node_name")
                    .table(Instances::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_instances_node_id")
                    .table(Instances::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(Instances::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum Instances {
    Table,
    InstanceId,
    TemplateId,
    ParamsJson,
    DisplayName,
    NodeId,
    NodeName,
    CreatedAt,
    UpdatedAt,
}
