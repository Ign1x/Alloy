use std::collections::BTreeMap;

use alloy_proto::agent_v1::{ParamType, TemplateParam};
use crate::game_adapter_template::TemplateParamKind;

#[derive(Debug, Clone)]
pub struct ProcessTemplate {
    pub template_id: String,
    pub display_name: String,
    pub command: String,
    pub args: Vec<String>,
    pub params: Vec<TemplateParam>,

    // Optional graceful shutdown string to write to stdin before SIGTERM.
    #[allow(dead_code)]
    pub graceful_stdin: Option<String>,
}

fn param_string(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    enum_values: Vec<&str>,
    placeholder: &str,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::String as i32,
        required,
        default_value: default_value.to_string(),
        min_int: 0,
        max_int: 0,
        enum_values: enum_values.into_iter().map(|s| s.to_string()).collect(),
        secret: false,
        placeholder: placeholder.to_string(),
        help: help.to_string(),
        advanced: false,
    }
}

fn param_string_advanced(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    enum_values: Vec<&str>,
    placeholder: &str,
    help: &str,
) -> TemplateParam {
    let mut p = param_string(
        key,
        label,
        required,
        default_value,
        enum_values,
        placeholder,
        help,
    );
    p.advanced = true;
    p
}

fn param_int(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    min_int: i64,
    max_int: i64,
    placeholder: &str,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::Int as i32,
        required,
        default_value: default_value.to_string(),
        min_int,
        max_int,
        enum_values: Vec::new(),
        secret: false,
        placeholder: placeholder.to_string(),
        help: help.to_string(),
        advanced: false,
    }
}

fn param_int_advanced(
    key: &str,
    label: &str,
    required: bool,
    default_value: &str,
    min_int: i64,
    max_int: i64,
    placeholder: &str,
    help: &str,
) -> TemplateParam {
    let mut p = param_int(
        key,
        label,
        required,
        default_value,
        min_int,
        max_int,
        placeholder,
        help,
    );
    p.advanced = true;
    p
}

fn param_bool_advanced(
    key: &str,
    label: &str,
    required: bool,
    default_value: bool,
    help: &str,
) -> TemplateParam {
    let mut p = param_bool(key, label, required, default_value, help);
    p.advanced = true;
    p
}

fn sandbox_params() -> Vec<TemplateParam> {
    vec![
        param_bool_advanced(
            "sandbox_enabled",
            "Sandbox enabled",
            false,
            true,
            "Enable sandbox isolation wrapper + resource limits for this instance.",
        ),
        param_string_advanced(
            "sandbox_mode",
            "Sandbox mode",
            false,
            "auto",
            vec!["auto", "docker", "bwrap", "native", "off"],
            "auto",
            "Per-instance sandbox backend override.",
        ),
        param_int_advanced(
            "sandbox_memory_mb",
            "Sandbox memory (MiB)",
            false,
            "4096",
            256,
            131072,
            "4096",
            "Hard memory ceiling. 0 means unlimited (not recommended).",
        ),
        param_int_advanced(
            "sandbox_pids_limit",
            "Sandbox PID limit",
            false,
            "512",
            32,
            32768,
            "512",
            "Maximum process count for the instance process tree.",
        ),
        param_int_advanced(
            "sandbox_nofile_limit",
            "Sandbox open files",
            false,
            "8192",
            256,
            1048576,
            "8192",
            "Maximum number of open file descriptors.",
        ),
        param_int_advanced(
            "sandbox_cpu_millicores",
            "Sandbox CPU (millicores)",
            false,
            "2000",
            100,
            64000,
            "2000",
            "CPU quota hint for cgroup (1000 = 1 core).",
        ),
        param_string_advanced(
            "restart_policy",
            "Restart policy",
            false,
            "off",
            vec!["off", "always", "on-failure"],
            "off",
            "Auto-restart behavior after process exit.",
        ),
        param_int_advanced(
            "restart_max_retries",
            "Restart max retries",
            false,
            "10",
            0,
            1000,
            "10",
            "Maximum auto-restart attempts.",
        ),
        param_int_advanced(
            "restart_backoff_ms",
            "Restart backoff (ms)",
            false,
            "1000",
            100,
            600000,
            "1000",
            "Initial restart delay in milliseconds.",
        ),
        param_int_advanced(
            "restart_backoff_max_ms",
            "Restart max backoff (ms)",
            false,
            "30000",
            100,
            3600000,
            "30000",
            "Maximum restart delay in milliseconds.",
        ),
    ]
}

fn param_bool(
    key: &str,
    label: &str,
    required: bool,
    default_value: bool,
    help: &str,
) -> TemplateParam {
    TemplateParam {
        key: key.to_string(),
        label: label.to_string(),
        r#type: ParamType::Bool as i32,
        required,
        default_value: default_value.to_string(),
        min_int: 0,
        max_int: 0,
        enum_values: Vec::new(),
        secret: false,
        placeholder: String::new(),
        help: help.to_string(),
        advanced: false,
    }
}

fn from_adapter_template_param(p: &crate::game_adapter_template::AdapterTemplateParam) -> TemplateParam {
    let (param_type, min_int, max_int, secret) = match p.kind {
        TemplateParamKind::String => (ParamType::String as i32, 0, 0, false),
        TemplateParamKind::Int { min, max } => (ParamType::Int as i32, min, max, false),
        TemplateParamKind::Bool => (ParamType::Bool as i32, 0, 0, false),
        TemplateParamKind::SecretString => (ParamType::String as i32, 0, 0, true),
    };

    TemplateParam {
        key: p.key.to_string(),
        label: p.label.to_string(),
        r#type: param_type,
        required: p.required,
        default_value: p.default_value.to_string(),
        min_int,
        max_int,
        enum_values: p.enum_values.iter().map(|v| (*v).to_string()).collect(),
        secret,
        placeholder: p.placeholder.to_string(),
        help: p.help.to_string(),
        advanced: p.advanced,
    }
}

fn from_adapter_template(t: &crate::game_adapter_template::AdapterTemplate) -> ProcessTemplate {
    ProcessTemplate {
        template_id: t.template_id.to_string(),
        display_name: t.display_name.to_string(),
        command: t.startup_command.to_string(),
        args: t.startup_args.iter().map(|v| v.to_string()).collect(),
        params: t.params.iter().map(from_adapter_template_param).collect(),
        graceful_stdin: t.graceful_stdin.map(str::to_string),
    }
}

pub fn list_templates() -> Vec<ProcessTemplate> {
    let mut templates = vec![ProcessTemplate {
        template_id: "demo:sleep".to_string(),
        display_name: "Demo: sleep".to_string(),
        command: "/bin/sleep".to_string(),
        args: vec!["60".to_string()],
        params: vec![param_int(
            "seconds",
            "Seconds",
            false,
            "60",
            1,
            3600,
            "60",
            "How long the demo process sleeps.",
        )],
        graceful_stdin: None,
    }];

    templates.extend(
        crate::game_adapter_template::list_adapter_templates()
            .iter()
            .map(from_adapter_template),
    );

    for t in &mut templates {
        if t.template_id != "demo:sleep" {
            t.params.extend(sandbox_params());
        }
    }

    templates
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
        let secs: u64 = match v.trim().parse() {
            Ok(v) => v,
            Err(_) => {
                let mut fields = BTreeMap::new();
                fields.insert(
                    "seconds".to_string(),
                    "Must be an integer (1..3600).".to_string(),
                );
                return Err(crate::error_payload::anyhow(
                    "invalid_param",
                    "invalid demo params",
                    Some(fields),
                    None,
                ));
            }
        };
        if !(1..=3600).contains(&secs) {
            let mut fields = BTreeMap::new();
            fields.insert(
                "seconds".to_string(),
                "Must be between 1 and 3600 seconds.".to_string(),
            );
            return Err(crate::error_payload::anyhow(
                "invalid_param",
                "invalid demo params",
                Some(fields),
                None,
            ));
        }
        t.args = vec![secs.to_string()];
    }

    let _ = crate::game_adapter_template::validate_template_params(&t.template_id, params)?;

    Ok(t)
}
