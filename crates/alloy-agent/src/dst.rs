use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

#[derive(Debug, Clone)]
pub struct VanillaParams {
    pub cluster_token: String,
    pub cluster_name: String,
    pub max_players: u32,
    pub password: Option<String>,
    // UDP game port exposed to clients.
    pub port: u16,
    // Steam ports (best-effort; required for discovery/auth).
    pub master_port: u16,
    pub auth_port: u16,
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    let cluster_token = params
        .get("cluster_token")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("")
        .to_string();
    if cluster_token.is_empty() {
        field_errors.insert(
            "cluster_token".to_string(),
            "Required. Paste your Klei cluster token.".to_string(),
        );
    }

    let cluster_name = params
        .get("cluster_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("Alloy DST server")
        .to_string();

    let max_players = match params
        .get("max_players")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 6,
        Some(raw) => match raw.parse::<u32>() {
            Ok(v) => v,
            Err(_) => {
                field_errors.insert(
                    "max_players".to_string(),
                    "Must be an integer between 1 and 64.".to_string(),
                );
                6
            }
        },
    };
    if !(1..=64).contains(&max_players) {
        field_errors.insert(
            "max_players".to_string(),
            "Must be between 1 and 64.".to_string(),
        );
    }

    let password = params
        .get("password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let port = parse_port(params.get("port"), 10999, &mut field_errors, "port");
    let master_port = parse_port(
        params.get("master_port"),
        27016,
        &mut field_errors,
        "master_port",
    );
    let auth_port = parse_port(
        params.get("auth_port"),
        8766,
        &mut field_errors,
        "auth_port",
    );

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid dst params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        cluster_token,
        cluster_name,
        max_players,
        password,
        port,
        master_port,
        auth_port,
    })
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

    let root = instance_dir.join("klei");
    let cluster = root.join("DoNotStarveTogether").join("Cluster_1");
    let master = cluster.join("Master");

    fs::create_dir_all(&master)?;

    // Required by DST.
    fs::write(
        cluster.join("cluster_token.txt"),
        format!("{}\n", params.cluster_token),
    )?;

    // Minimal cluster.ini (single shard).
    let mut cluster_ini = String::new();
    cluster_ini.push_str("[GAMEPLAY]\n");
    cluster_ini.push_str("game_mode = survival\n");
    cluster_ini.push_str(&format!("max_players = {}\n", params.max_players));
    cluster_ini.push_str("pvp = false\n");
    cluster_ini.push_str("pause_when_empty = true\n\n");

    cluster_ini.push_str("[NETWORK]\n");
    cluster_ini.push_str(&format!("cluster_name = {}\n", params.cluster_name));
    cluster_ini.push_str("cluster_description = Alloy DST server\n");
    cluster_ini.push_str("cluster_intention = cooperative\n");
    if let Some(pw) = &params.password {
        cluster_ini.push_str(&format!("cluster_password = {}\n", pw));
    } else {
        cluster_ini.push_str("cluster_password =\n");
    }
    cluster_ini.push_str("offline_cluster = false\n\n");

    cluster_ini.push_str("[MISC]\n");
    cluster_ini.push_str("console_enabled = true\n\n");

    cluster_ini.push_str("[SHARD]\n");
    cluster_ini.push_str("shard_enabled = false\n");
    fs::write(cluster.join("cluster.ini"), cluster_ini.as_bytes())?;

    // Master shard server.ini.
    let mut server_ini = String::new();
    server_ini.push_str("[NETWORK]\n");
    server_ini.push_str(&format!("server_port = {}\n\n", params.port));
    server_ini.push_str("[SHARD]\n");
    server_ini.push_str("is_master = true\n");
    server_ini.push_str("name = Master\n");
    server_ini.push_str("id = 1\n\n");
    server_ini.push_str("[ACCOUNT]\n");
    server_ini.push_str("encode_user_path = true\n\n");
    server_ini.push_str("[STEAM]\n");
    server_ini.push_str(&format!("master_server_port = {}\n", params.master_port));
    server_ini.push_str(&format!("authentication_port = {}\n", params.auth_port));
    fs::write(master.join("server.ini"), server_ini.as_bytes())?;

    Ok(())
}
