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
    // Version is currently a server package version like "1453".
    let version = params
        .get("version")
        .cloned()
        .unwrap_or_else(|| "1453".to_string());
    if !version.chars().all(|c| c.is_ascii_digit()) {
        anyhow::bail!("invalid version: {version}");
    }

    let port = params
        .get("port")
        .map(|v| v.parse::<u16>())
        .transpose()
        .map_err(|_| anyhow::anyhow!("invalid port"))?
        .unwrap_or(7777);
    if port < 1024 {
        anyhow::bail!("port out of range: {port}");
    }

    let max_players = params
        .get("max_players")
        .map(|v| v.parse::<u32>())
        .transpose()
        .map_err(|_| anyhow::anyhow!("invalid max_players"))?
        .unwrap_or(8);
    if !(1..=255).contains(&max_players) {
        anyhow::bail!("max_players out of range: {max_players}");
    }

    let world_name = params
        .get("world_name")
        .cloned()
        .unwrap_or_else(|| "world".to_string());
    if world_name.trim().is_empty() {
        anyhow::bail!("world_name must be non-empty");
    }
    // Keep world name safe for paths.
    if !world_name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    {
        anyhow::bail!("invalid world_name: {world_name}");
    }

    // Terraria uses: 1=Small, 2=Medium, 3=Large.
    let world_size = params
        .get("world_size")
        .map(|v| v.parse::<u8>())
        .transpose()
        .map_err(|_| anyhow::anyhow!("invalid world_size"))?
        .unwrap_or(1);
    if !(1..=3).contains(&world_size) {
        anyhow::bail!("world_size out of range: {world_size}");
    }

    let password = params.get("password").cloned().filter(|s| !s.is_empty());

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
    fs::create_dir_all(instance_dir.join("worlds"))?;

    let world_path = instance_dir
        .join("worlds")
        .join(format!("{}.wld", params.world_name));

    // Minimal, deterministic serverconfig.
    // NOTE: Terraria will autocreate if the world file does not exist.
    let mut cfg = String::new();
    cfg.push_str("secure=1\n");
    cfg.push_str("upnp=0\n");
    cfg.push_str(&format!("port={}\n", params.port));
    cfg.push_str(&format!("maxplayers={}\n", params.max_players));
    if let Some(pw) = &params.password {
        cfg.push_str(&format!("password={}\n", pw));
    }
    cfg.push_str(&format!("world={}\n", world_path.display()));
    cfg.push_str(&format!("worldname={}\n", params.world_name));
    if !world_path.exists() {
        cfg.push_str(&format!("autocreate={}\n", params.world_size));
        cfg.push_str("difficulty=0\n");
    }

    fs::write(instance_dir.join("serverconfig.txt"), cfg.as_bytes())?;
    Ok(())
}
