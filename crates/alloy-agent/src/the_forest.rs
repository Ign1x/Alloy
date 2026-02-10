use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

#[derive(Debug, Clone)]
pub struct VanillaParams {
    pub name: String,
    pub port: u16,
    pub query_port: u16,
    pub max_players: u32,
    pub password: Option<String>,
}

fn parse_port(
    raw: Option<&String>,
    default_value: u16,
    field_errors: &mut BTreeMap<String, String>,
    key: &str,
) -> u16 {
    match raw.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        None => default_value,
        Some(v) => match v.parse::<u16>() {
            Ok(0) => 0,
            Ok(p) if p >= 1024 => p,
            Ok(p) => {
                field_errors.insert(
                    key.to_string(),
                    format!("Must be 0 (auto) or in 1024..65535 (got {p})."),
                );
                p
            }
            Err(_) => {
                field_errors.insert(
                    key.to_string(),
                    "Must be an integer (0 for auto, or 1024..65535).".to_string(),
                );
                default_value
            }
        },
    }
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    let name = params
        .get("server_name")
        .or_else(|| params.get("name"))
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("Alloy The Forest server")
        .to_string();

    let port = parse_port(params.get("port"), 27015, &mut field_errors, "port");
    let query_port = parse_port(
        params.get("query_port"),
        27016,
        &mut field_errors,
        "query_port",
    );

    let max_players = match params
        .get("max_players")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 8,
        Some(raw) => match raw.parse::<u32>() {
            Ok(v) => v,
            Err(_) => {
                field_errors.insert(
                    "max_players".to_string(),
                    "Must be an integer between 1 and 32.".to_string(),
                );
                8
            }
        },
    };
    if !(1..=32).contains(&max_players) {
        field_errors.insert(
            "max_players".to_string(),
            "Must be between 1 and 32.".to_string(),
        );
    }

    let password = params
        .get("password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid the_forest params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        name,
        port,
        query_port,
        max_players,
        password,
    })
}

pub fn data_root() -> PathBuf {
    crate::minecraft::data_root()
}

pub fn instance_dir(process_id: &str) -> PathBuf {
    data_root().join("instances").join(process_id)
}

pub fn ensure_vanilla_instance_layout(
    instance_dir: &Path,
    _params: &VanillaParams,
) -> anyhow::Result<()> {
    fs::create_dir_all(instance_dir)?;
    fs::create_dir_all(instance_dir.join("logs"))?;
    fs::create_dir_all(instance_dir.join("config"))?;
    fs::create_dir_all(instance_dir.join("data"))?;
    Ok(())
}
