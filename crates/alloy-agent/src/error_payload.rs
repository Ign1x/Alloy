use std::collections::BTreeMap;

pub const PREFIX: &str = "ALLOY_ERROR_JSON:";

const MAX_MESSAGE_BYTES: usize = 32 * 1024;
const MAX_HINT_BYTES: usize = 8 * 1024;
const MAX_FIELD_ERROR_BYTES: usize = 4 * 1024;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ErrorPayload {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field_errors: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

fn truncate_utf8(s: &str, max_bytes: usize) -> String {
    if s.len() <= max_bytes {
        return s.to_string();
    }

    let suffix = "…(truncated)";
    let keep = max_bytes.saturating_sub(suffix.len()).max(1);
    let mut end = keep.min(s.len());
    while end > 0 && !s.is_char_boundary(end) {
        end = end.saturating_sub(1);
    }
    let mut out = s[..end].to_string();
    out.push_str(suffix);
    out
}

pub fn encode(
    code: &str,
    message: impl Into<String>,
    field_errors: Option<BTreeMap<String, String>>,
    hint: Option<String>,
) -> String {
    let message = truncate_utf8(&message.into(), MAX_MESSAGE_BYTES);

    let field_errors = field_errors.map(|mut m| {
        for v in m.values_mut() {
            *v = truncate_utf8(v, MAX_FIELD_ERROR_BYTES);
        }
        m
    });

    let hint = hint.map(|h| truncate_utf8(&h, MAX_HINT_BYTES));

    let payload = ErrorPayload {
        code: code.to_string(),
        message,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_truncates_message() {
        let long = "a".repeat(MAX_MESSAGE_BYTES + 1024);
        let s = encode("test", long, None, None);
        assert!(s.starts_with(PREFIX));

        let json = &s[PREFIX.len()..];
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let msg = v.get("message").unwrap().as_str().unwrap();
        assert!(msg.len() <= MAX_MESSAGE_BYTES);
        assert!(msg.ends_with("…(truncated)"));
    }

    #[test]
    fn encode_truncates_hint_and_field_errors() {
        let mut fields = BTreeMap::new();
        fields.insert("x".to_string(), "b".repeat(MAX_FIELD_ERROR_BYTES + 1024));
        let hint = Some("c".repeat(MAX_HINT_BYTES + 1024));
        let s = encode("test", "msg", Some(fields), hint);

        let json = &s[PREFIX.len()..];
        let v: serde_json::Value = serde_json::from_str(json).unwrap();
        let field = v
            .get("field_errors")
            .unwrap()
            .get("x")
            .unwrap()
            .as_str()
            .unwrap();
        assert!(field.len() <= MAX_FIELD_ERROR_BYTES);
        assert!(field.ends_with("…(truncated)"));

        let hint = v.get("hint").unwrap().as_str().unwrap();
        assert!(hint.len() <= MAX_HINT_BYTES);
        assert!(hint.ends_with("…(truncated)"));
    }
}
