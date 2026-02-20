use std::collections::BTreeMap;

#[derive(Clone, Debug)]
pub struct AdapterTemplateParam {
    pub key: &'static str,
    pub required: bool,
    pub default_value: &'static str,
}

#[derive(Clone, Debug)]
pub struct AdapterTemplate {
    pub template_id: &'static str,
    pub display_name: &'static str,
    pub startup_command: &'static str,
    pub startup_args: &'static [&'static str],
    pub params: &'static [AdapterTemplateParam],
}

const MINIMAL_GENERIC_TEMPLATE_PARAMS: &[AdapterTemplateParam] = &[
    AdapterTemplateParam {
        key: "port",
        required: false,
        default_value: "0",
    },
    AdapterTemplateParam {
        key: "memory_mb",
        required: false,
        default_value: "2048",
    },
];

pub const MINIMAL_GENERIC_TEMPLATE: AdapterTemplate = AdapterTemplate {
    template_id: "example:generic",
    display_name: "Example: Generic Server",
    startup_command: "/bin/sleep",
    startup_args: &["60"],
    params: MINIMAL_GENERIC_TEMPLATE_PARAMS,
};

pub fn validate_required_params(
    template: &AdapterTemplate,
    params: &BTreeMap<String, String>,
) -> anyhow::Result<()> {
    for p in template.params {
        if !p.required {
            continue;
        }

        let value = params.get(p.key).map(|v| v.trim()).unwrap_or("");
        if value.is_empty() {
            anyhow::bail!("missing required param: {}", p.key);
        }
    }
    Ok(())
}
