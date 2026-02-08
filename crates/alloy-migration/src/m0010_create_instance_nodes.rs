use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(InstanceNodes::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(InstanceNodes::InstanceId)
                            .string()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(InstanceNodes::NodeId).uuid().null())
                    .col(ColumnDef::new(InstanceNodes::NodeName).string().not_null())
                    .col(
                        ColumnDef::new(InstanceNodes::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(InstanceNodes::UpdatedAt)
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
                    .name("idx_instance_nodes_node_id")
                    .table(InstanceNodes::Table)
                    .col(InstanceNodes::NodeId)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_instance_nodes_node_name")
                    .table(InstanceNodes::Table)
                    .col(InstanceNodes::NodeName)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_instance_nodes_node_name")
                    .table(InstanceNodes::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_instance_nodes_node_id")
                    .table(InstanceNodes::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(InstanceNodes::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum InstanceNodes {
    Table,
    InstanceId,
    NodeId,
    NodeName,
    CreatedAt,
    UpdatedAt,
}
