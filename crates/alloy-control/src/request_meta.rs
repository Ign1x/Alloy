#[derive(Clone, Debug)]
pub struct RequestMeta {
    pub request_id: String,
    pub method: String,
    pub path: String,
    pub origin: Option<String>,
    pub referer: Option<String>,
    pub user_agent: Option<String>,
    pub client_ip: Option<String>,
}
