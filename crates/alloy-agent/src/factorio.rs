use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct VanillaParams {
    pub version: String,
    pub port: u16,
    pub max_players: u32,
    pub server_name: String,
    pub server_description: String,
    pub public: bool,
    pub rcon_enabled: bool,
    pub rcon_port: u16,
    pub rcon_password: Option<String>,
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

fn parse_bool(raw: Option<&String>, default_value: bool) -> bool {
    match raw.map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => default_value,
        Some(v) if v.eq_ignore_ascii_case("true") || v == "1" || v.eq_ignore_ascii_case("yes") => {
            true
        }
        Some(v) if v.eq_ignore_ascii_case("false") || v == "0" || v.eq_ignore_ascii_case("no") => {
            false
        }
        Some(_) => default_value,
    }
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    let version = params
        .get("version")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("stable")
        .to_string();
    if version != "stable"
        && version != "experimental"
        && !version
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
    {
        field_errors.insert(
            "version".to_string(),
            "Use stable / experimental or an explicit version like 1.1.110.".to_string(),
        );
    }

    let port = parse_port(params.get("port"), 34197, &mut field_errors, "port");

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
                    "Must be an integer between 1 and 1024.".to_string(),
                );
                8
            }
        },
    };
    if !(1..=1024).contains(&max_players) {
        field_errors.insert(
            "max_players".to_string(),
            "Must be between 1 and 1024.".to_string(),
        );
    }

    let server_name = params
        .get("server_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("Alloy Factorio server")
        .to_string();
    let server_description = params
        .get("server_description")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("")
        .to_string();

    let public = parse_bool(params.get("public"), false);
    let rcon_enabled = parse_bool(params.get("rcon_enabled"), false);
    let rcon_port = parse_port(
        params.get("rcon_port"),
        27015,
        &mut field_errors,
        "rcon_port",
    );
    let rcon_password = params
        .get("rcon_password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if rcon_enabled && rcon_password.is_none() {
        field_errors.insert(
            "rcon_password".to_string(),
            "RCON password is required when RCON is enabled.".to_string(),
        );
    }

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid factorio params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        version,
        port,
        max_players,
        server_name,
        server_description,
        public,
        rcon_enabled,
        rcon_port,
        rcon_password,
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
    params: &VanillaParams,
) -> anyhow::Result<()> {
    fs::create_dir_all(instance_dir)?;
    fs::create_dir_all(instance_dir.join("config"))?;
    fs::create_dir_all(instance_dir.join("saves"))?;
    fs::create_dir_all(instance_dir.join("mods"))?;
    fs::create_dir_all(instance_dir.join("logs"))?;

    let mut obj = serde_json::Map::<String, serde_json::Value>::new();
    obj.insert(
        "name".to_string(),
        serde_json::Value::String(params.server_name.clone()),
    );
    obj.insert(
        "description".to_string(),
        serde_json::Value::String(params.server_description.clone()),
    );
    obj.insert(
        "max_players".to_string(),
        serde_json::Value::from(params.max_players),
    );
    obj.insert("visibility".to_string(), {
        let mut vis = serde_json::Map::<String, serde_json::Value>::new();
        vis.insert("public".to_string(), serde_json::Value::Bool(params.public));
        vis.insert("lan".to_string(), serde_json::Value::Bool(false));
        serde_json::Value::Object(vis)
    });
    obj.insert(
        "require_user_verification".to_string(),
        serde_json::Value::Bool(true),
    );
    obj.insert(
        "max_upload_in_kilobytes_per_second".to_string(),
        serde_json::Value::from(0),
    );
    obj.insert("max_upload_slots".to_string(), serde_json::Value::from(5));
    obj.insert(
        "ignore_player_limit_for_returning_players".to_string(),
        serde_json::Value::Bool(false),
    );
    obj.insert(
        "allow_commands".to_string(),
        serde_json::Value::String("admins-only".to_string()),
    );
    obj.insert("autosave_interval".to_string(), serde_json::Value::from(10));
    obj.insert("autosave_slots".to_string(), serde_json::Value::from(5));
    obj.insert(
        "afk_autokick_interval".to_string(),
        serde_json::Value::from(0),
    );
    obj.insert("auto_pause".to_string(), serde_json::Value::Bool(false));
    obj.insert(
        "only_admins_can_pause_the_game".to_string(),
        serde_json::Value::Bool(true),
    );
    obj.insert(
        "game_password".to_string(),
        serde_json::Value::String(String::new()),
    );
    obj.insert(
        "admin_password".to_string(),
        serde_json::Value::String(String::new()),
    );
    obj.insert(
        "server_password".to_string(),
        serde_json::Value::String(String::new()),
    );

    let json = serde_json::to_string_pretty(&serde_json::Value::Object(obj))?;
    fs::write(
        instance_dir.join("config").join("server-settings.json"),
        json.as_bytes(),
    )?;

    let config_ini = format!(
        "[path]\nread-data=__PATH__executable__/../../data\nwrite-data={}\n",
        instance_dir.display()
    );
    fs::write(
        instance_dir.join("config").join("config.ini"),
        config_ini.as_bytes(),
    )?;

    Ok(())
}

pub fn ensure_default_save(instance_dir: &Path, binary: &Path) -> anyhow::Result<PathBuf> {
    let saves_dir = instance_dir.join("saves");
    fs::create_dir_all(&saves_dir)?;

    if let Ok(rd) = fs::read_dir(&saves_dir) {
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .extension()
                    .and_then(|v| v.to_str())
                    .is_some_and(|v| v.eq_ignore_ascii_case("zip"))
            {
                return Ok(path);
            }
        }
    }

    let save_path = saves_dir.join("alloy-default.zip");
    let settings_path = instance_dir.join("config").join("server-settings.json");

    let config_path = instance_dir.join("config").join("config.ini");

    let mut cmd = std::process::Command::new(binary);
    cmd.arg("--create")
        .arg(&save_path)
        .arg("--server-settings")
        .arg(&settings_path);
    if config_path.is_file() {
        cmd.arg("--config").arg(&config_path);
    }

    let out = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output()
        .with_context(|| format!("create factorio default save via {}", binary.display()))?;

    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        anyhow::bail!(
            "failed to create default factorio save (exit {}):\nstdout:\n{}\nstderr:\n{}",
            out.status,
            stdout,
            stderr
        );
    }

    if !save_path.exists() {
        anyhow::bail!(
            "default factorio save not found after --create: {}",
            save_path.display()
        );
    }

    Ok(save_path)
}
