use sea_orm_migration::prelude::*;

#[derive(DeriveMigrationName)]
pub struct Migration;

#[async_trait::async_trait]
impl MigrationTrait for Migration {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .create_table(
                Table::create()
                    .table(DownloadJobs::Table)
                    .if_not_exists()
                    .col(
                        ColumnDef::new(DownloadJobs::Id)
                            .uuid()
                            .not_null()
                            .primary_key(),
                    )
                    .col(ColumnDef::new(DownloadJobs::Target).string().not_null())
                    .col(ColumnDef::new(DownloadJobs::TemplateId).string().not_null())
                    .col(ColumnDef::new(DownloadJobs::Version).string().not_null())
                    .col(ColumnDef::new(DownloadJobs::ParamsJson).text().not_null())
                    .col(ColumnDef::new(DownloadJobs::State).string().not_null())
                    .col(ColumnDef::new(DownloadJobs::Message).text().not_null())
                    .col(ColumnDef::new(DownloadJobs::RequestId).string().null())
                    .col(
                        ColumnDef::new(DownloadJobs::QueuePosition)
                            .big_integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DownloadJobs::AttemptCount)
                            .integer()
                            .not_null()
                            .default(0),
                    )
                    .col(
                        ColumnDef::new(DownloadJobs::CreatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(DownloadJobs::UpdatedAt)
                            .timestamp_with_time_zone()
                            .not_null()
                            .default(Expr::current_timestamp()),
                    )
                    .col(
                        ColumnDef::new(DownloadJobs::StartedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .col(
                        ColumnDef::new(DownloadJobs::FinishedAt)
                            .timestamp_with_time_zone()
                            .null(),
                    )
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_download_jobs_state_queue_position")
                    .table(DownloadJobs::Table)
                    .col(DownloadJobs::State)
                    .col(DownloadJobs::QueuePosition)
                    .to_owned(),
            )
            .await?;

        manager
            .create_index(
                Index::create()
                    .name("idx_download_jobs_updated_at")
                    .table(DownloadJobs::Table)
                    .col(DownloadJobs::UpdatedAt)
                    .to_owned(),
            )
            .await
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .drop_index(
                Index::drop()
                    .name("idx_download_jobs_updated_at")
                    .table(DownloadJobs::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_index(
                Index::drop()
                    .name("idx_download_jobs_state_queue_position")
                    .table(DownloadJobs::Table)
                    .to_owned(),
            )
            .await?;

        manager
            .drop_table(Table::drop().table(DownloadJobs::Table).to_owned())
            .await
    }
}

#[derive(DeriveIden)]
enum DownloadJobs {
    Table,
    Id,
    Target,
    TemplateId,
    Version,
    ParamsJson,
    State,
    Message,
    RequestId,
    QueuePosition,
    AttemptCount,
    CreatedAt,
    UpdatedAt,
    StartedAt,
    FinishedAt,
}
