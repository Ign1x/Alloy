use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

#[derive(Debug, Clone)]
pub struct VanillaParams {
    pub server_name: String,
    pub world: String,
    pub game_name: String,
    pub port: u16,
    pub query_port: u16,
    pub control_panel_port: u16,
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

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    let server_name = params
        .get("server_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("Alloy 7 Days to Die server")
        .to_string();

    let world = params
        .get("world")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("Navezgane")
        .to_string();

    let game_name = params
        .get("game_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("alloy")
        .to_string();

    let port = parse_port(params.get("port"), 26900, &mut field_errors, "port");
    let query_port = parse_port(
        params.get("query_port"),
        26901,
        &mut field_errors,
        "query_port",
    );
    let control_panel_port = parse_port(
        params.get("control_panel_port"),
        8080,
        &mut field_errors,
        "control_panel_port",
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
                    "Must be an integer between 1 and 128.".to_string(),
                );
                8
            }
        },
    };
    if !(1..=128).contains(&max_players) {
        field_errors.insert(
            "max_players".to_string(),
            "Must be between 1 and 128.".to_string(),
        );
    }

    let password = params
        .get("password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid seven_days params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        server_name,
        world,
        game_name,
        port,
        query_port,
        control_panel_port,
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
    params: &VanillaParams,
) -> anyhow::Result<()> {
    fs::create_dir_all(instance_dir)?;
    fs::create_dir_all(instance_dir.join("logs"))?;
    fs::create_dir_all(instance_dir.join("config"))?;
    fs::create_dir_all(instance_dir.join("save"))?;

    let mut cfg = String::new();
    cfg.push_str("<?xml version=\"1.0\"?>\n");
    cfg.push_str("<ServerSettings>\n");
    cfg.push_str(&format!(
        "  <property name=\"ServerName\" value=\"{}\"/>\n",
        xml_escape(&params.server_name)
    ));
    cfg.push_str(&format!(
        "  <property name=\"ServerPort\" value=\"{}\"/>\n",
        params.port
    ));
    cfg.push_str(&format!(
        "  <property name=\"ServerPortUDP\" value=\"{}\"/>\n",
        params.query_port
    ));
    cfg.push_str(&format!(
        "  <property name=\"ControlPanelPort\" value=\"{}\"/>\n",
        params.control_panel_port
    ));
    cfg.push_str(&format!(
        "  <property name=\"ServerMaxPlayerCount\" value=\"{}\"/>\n",
        params.max_players
    ));
    cfg.push_str(&format!(
        "  <property name=\"GameWorld\" value=\"{}\"/>\n",
        xml_escape(&params.world)
    ));
    cfg.push_str(&format!(
        "  <property name=\"GameName\" value=\"{}\"/>\n",
        xml_escape(&params.game_name)
    ));
    cfg.push_str("  <property name=\"SaveGameFolder\" value=\"save\"/>\n");
    cfg.push_str("  <property name=\"ServerPassword\" value=\"");
    if let Some(v) = &params.password {
        cfg.push_str(&xml_escape(v));
    }
    cfg.push_str("\"/>\n");
    cfg.push_str("</ServerSettings>\n");

    fs::write(
        instance_dir.join("config").join("serverconfig.xml"),
        cfg.as_bytes(),
    )?;
    Ok(())
}
