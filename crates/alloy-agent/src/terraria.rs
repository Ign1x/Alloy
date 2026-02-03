use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VanillaParams {
    pub version: String,
    pub port: u16,
    pub max_players: u32,
    pub world_name: String,
    pub world_size: u8,
    pub password: Option<String>,
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    // Version is currently a server package version like "1453".
    let version = params
        .get("version")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("1453")
        .to_string();
    if !version.chars().all(|c| c.is_ascii_digit()) {
        field_errors.insert(
            "version".to_string(),
            "Must be a numeric package id like 1453 (1.4.5.3).".to_string(),
        );
    }

    let port = match params
        .get("port")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 0,
        Some(raw) => match raw.parse::<u16>() {
            Ok(0) => 0,
            Ok(v) if v >= 1024 => v,
            Ok(v) => {
                field_errors.insert(
                    "port".to_string(),
                    format!("Must be 0 (auto) or in 1024..65535 (got {v})."),
                );
                v
            }
            Err(_) => {
                field_errors.insert(
                    "port".to_string(),
                    "Must be an integer (0 for auto, or 1024..65535).".to_string(),
                );
                0
            }
        },
    };

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
                    "Must be an integer between 1 and 255.".to_string(),
                );
                8
            }
        },
    };
    if !(1..=255).contains(&max_players) {
        field_errors.insert(
            "max_players".to_string(),
            "Must be between 1 and 255.".to_string(),
        );
    }

    let world_name = params
        .get("world_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("world")
        .to_string();
    if world_name.trim().is_empty() {
        field_errors.insert("world_name".to_string(), "Must be non-empty.".to_string());
    }
    // Keep world name safe for paths.
    if !world_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        field_errors.insert(
            "world_name".to_string(),
            "Only letters, digits, '-', '_' and '.' are allowed.".to_string(),
        );
    }

    // Terraria uses: 1=Small, 2=Medium, 3=Large.
    let world_size = match params
        .get("world_size")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 1,
        Some(raw) => match raw.parse::<u8>() {
            Ok(v) => v,
            Err(_) => {
                field_errors.insert(
                    "world_size".to_string(),
                    "Must be 1 (Small), 2 (Medium), or 3 (Large).".to_string(),
                );
                1
            }
        },
    };
    if !(1..=3).contains(&world_size) {
        field_errors.insert(
            "world_size".to_string(),
            "Must be 1 (Small), 2 (Medium), or 3 (Large).".to_string(),
        );
    }

    let password = params.get("password").cloned().filter(|s| !s.is_empty());

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid terraria params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        version,
        port,
        max_players,
        world_name,
        world_size,
        password,
    })
}

pub fn data_root() -> PathBuf {
    // Re-use the same env var as Minecraft data root.
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
    fs::create_dir_all(instance_dir.join("worlds"))?;
    fs::create_dir_all(instance_dir.join("mods"))?;

    // NOTE: The Terraria server is executed from the extracted server root
    // (to keep `monoconfig/assemblies/Content` adjacent to the binary).
    // That means any relative paths in `serverconfig.txt` will be resolved
    // against the extracted server root, not this instance directory.
    //
    // Use absolute paths so world/config live under the instance directory
    // regardless of the current working directory.
    let instance_dir_abs = if instance_dir.is_absolute() {
        instance_dir.to_path_buf()
    } else {
        std::env::current_dir()?.join(instance_dir)
    };
    let instance_dir_abs = fs::canonicalize(&instance_dir_abs).unwrap_or(instance_dir_abs);

    let config_dir_abs = instance_dir_abs.join("config");
    let world_path = instance_dir_abs
        .join("worlds")
        .join(format!("{}.wld", params.world_name));
    let banlist_path = config_dir_abs.join("banlist.txt");

    // Minimal, deterministic serverconfig.
    // NOTE: Terraria will autocreate if the world file does not exist.
    let mut cfg = String::new();
    cfg.push_str("secure=1\n");
    cfg.push_str("upnp=0\n");
    cfg.push_str(&format!("port={}\n", params.port));
    cfg.push_str(&format!("maxplayers={}\n", params.max_players));
    cfg.push_str("npcstream=60\n");
    cfg.push_str("motd=Alloy Terraria server\n");
    cfg.push_str(&format!("banlist={}\n", banlist_path.display()));
    if let Some(pw) = &params.password {
        cfg.push_str(&format!("password={}\n", pw));
    }
    cfg.push_str(&format!("world={}\n", world_path.display()));
    cfg.push_str(&format!("worldname={}\n", params.world_name));
    if !world_path.exists() {
        cfg.push_str(&format!("autocreate={}\n", params.world_size));
        cfg.push_str("difficulty=0\n");
    }

    // Persist config and banlist under instance config/.
    let config_dir = instance_dir.join("config");
    if !config_dir.exists() {
        fs::create_dir_all(&config_dir)?;
    }
    fs::write(config_dir.join("serverconfig.txt"), cfg.as_bytes())?;
    if !banlist_path.exists() {
        let _ = fs::write(config_dir.join("banlist.txt"), b"");
    }
    Ok(())
}
