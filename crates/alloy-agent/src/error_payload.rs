use std::collections::BTreeMap;

pub const PREFIX: &str = "ALLOY_ERROR_JSON:";

#[derive(Debug, Clone, serde::Serialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

pub fn encode(
    code: &str,
    message: impl Into<String>,
    field_errors: Option<BTreeMap<String, String>>,
    hint: Option<String>,
) -> String {
    let payload = ErrorPayload {
        code: code.to_string(),
        message: message.into(),
        field_errors,
        hint,
    };

    let json = serde_json::to_string(&payload)
        .unwrap_or_else(|_| "{\"code\":\"internal\",\"message\":\"serialize_failed\"}".to_string());

    format!("{PREFIX}{json}")
}

pub fn anyhow(
    code: &str,
    message: impl Into<String>,
    field_errors: Option<BTreeMap<String, String>>,
    hint: Option<String>,
) -> anyhow::Error {
    anyhow::anyhow!(encode(code, message, field_errors, hint))
}
