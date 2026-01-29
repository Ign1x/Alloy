use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub struct ProcessTemplate {
    pub template_id: String,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,

    // Optional graceful shutdown string to write to stdin before SIGTERM.
    #[allow(dead_code)]
    pub graceful_stdin: Option<String>,
}

pub fn list_templates() -> Vec<ProcessTemplate> {
    // Phase 1: hardcoded templates to avoid turning the control plane into RCE.
    // These are demos; game adapters will provide real templates later.
    vec![ProcessTemplate {
        template_id: "demo:sleep".to_string(),
        display_name: "Demo: sleep".to_string(),
        command: "/bin/sleep".to_string(),
        args: vec!["60".to_string()],
        graceful_stdin: None,
    }]
}

pub fn find_template(template_id: &str) -> Option<ProcessTemplate> {
    list_templates()
        .into_iter()
        .find(|t| t.template_id == template_id)
}

pub fn apply_params(
    mut t: ProcessTemplate,
    params: &BTreeMap<String, String>,
) -> anyhow::Result<ProcessTemplate> {
    // Phase 1 minimal params:
    // - demo:sleep: { seconds: "1..=3600" }
    if t.template_id == "demo:sleep"
        && let Some(v) = params.get("seconds")
    {
        let secs: u64 = v
            .parse()
            .map_err(|_| anyhow::anyhow!("invalid seconds: {v}"))?;
        if !(1..=3600).contains(&secs) {
            anyhow::bail!("seconds out of range: {secs}");
        }
        t.args = vec![secs.to_string()];
    }

    Ok(t)
}
