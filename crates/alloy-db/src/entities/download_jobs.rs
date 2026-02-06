use sea_orm::entity::prelude::*;

#[derive(Clone, Debug, PartialEq, DeriveEntityModel)]
#[sea_orm(table_name = "download_jobs")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub id: Uuid,
    pub target: String,
    pub template_id: String,
    pub version: String,
    pub params_json: String,
    pub state: String,
    pub message: String,
    pub request_id: Option<String>,
    pub queue_position: i64,
    pub attempt_count: i32,
    pub created_at: DateTimeWithTimeZone,
    pub updated_at: DateTimeWithTimeZone,
    pub started_at: Option<DateTimeWithTimeZone>,
    pub finished_at: Option<DateTimeWithTimeZone>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {}

impl ActiveModelBehavior for ActiveModel {}
