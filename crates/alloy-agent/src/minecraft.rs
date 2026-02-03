use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct VanillaParams {
    pub version: String,
    pub memory_mb: u32,
    pub port: u16,
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    // EULA must be accepted explicitly (legal + UX).
    match params.get("accept_eula").map(|v| v.trim()) {
        Some("true") => {}
        _ => {
            field_errors.insert(
                "accept_eula".to_string(),
                "Required. You must accept the Minecraft EULA.".to_string(),
            );
        }
    }

    let version = params
        .get("version")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("latest_release")
        .to_string();

    let memory_mb = match params
        .get("memory_mb")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 2048,
        Some(raw) => match raw.parse::<u32>() {
            Ok(v) => v,
            Err(_) => {
                field_errors.insert(
                    "memory_mb".to_string(),
                    "Must be an integer (MiB), e.g. 2048.".to_string(),
                );
                2048
            }
        },
    };
    if !(512..=65536).contains(&memory_mb) {
        field_errors.insert(
            "memory_mb".to_string(),
            "Must be between 512 and 65536 (MiB).".to_string(),
        );
    }

    // Port: allow empty/0 for auto allocation.
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

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid minecraft params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        version,
        memory_mb,
        port,
    })
}

pub fn data_root() -> PathBuf {
    let raw = std::env::var("ALLOY_DATA_ROOT").unwrap_or_else(|_| "./data".to_string());
    let p = PathBuf::from(raw);
    let abs = if p.is_absolute() {
        p
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(p)
    };

    // Best-effort canonicalization: don't fail if the directory doesn't exist yet.
    std::fs::canonicalize(&abs).unwrap_or(abs)
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
    fs::create_dir_all(instance_dir.join("logs"))?;

    let config_dir = instance_dir.join("config");

    fn migrate_into_config_dir(instance_dir: &Path, config_dir: &Path, name: &str) {
        let src = instance_dir.join(name);
        let dst = config_dir.join(name);
        if dst.exists() {
            return;
        }
        if src.exists() {
            let _ = fs::rename(&src, &dst);
        }
    }

    migrate_into_config_dir(instance_dir, &config_dir, "eula.txt");
    migrate_into_config_dir(instance_dir, &config_dir, "server.properties");

    // EULA gate is handled by validate_vanilla_params(); writing eula=true is the
    // explicit acceptance action.
    fs::write(config_dir.join("eula.txt"), b"eula=true\n")?;

    // Ensure root-level config files exist for the Minecraft server by symlinking into config/.
    #[cfg(unix)]
    fn ensure_link(instance_dir: &Path, name: &str) -> anyhow::Result<()> {
        let root_path = instance_dir.join(name);
        let target_rel = PathBuf::from("config").join(name);
        if root_path.exists() {
            let _ = fs::remove_file(&root_path);
        }
        std::os::unix::fs::symlink(target_rel, root_path)?;
        Ok(())
    }

    #[cfg(not(unix))]
    fn ensure_link(instance_dir: &Path, name: &str) -> anyhow::Result<()> {
        let root_path = instance_dir.join(name);
        let target = instance_dir.join("config").join(name);
        fs::copy(target, root_path)?;
        Ok(())
    }

    ensure_link(instance_dir, "eula.txt")?;

    // Minimal `server.properties` management: ensure server-port is set.
    let props_path = config_dir.join("server.properties");
    let existing = fs::read_to_string(&props_path).unwrap_or_default();
    let mut out = String::new();
    let mut wrote_port = false;
    let mut wrote_level_name = false;
    for line in existing.lines() {
        if let Some((_k, _v)) = line.split_once('=')
            && line.starts_with("server-port=")
        {
            out.push_str(&format!("server-port={}\n", params.port));
            wrote_port = true;
            continue;
        }
        if let Some((_k, _v)) = line.split_once('=')
            && line.starts_with("level-name=")
        {
            // Keep existing world location if the user already set one.
            // For new instances, we default to `worlds/world` for a consistent layout.
            wrote_level_name = true;
            out.push_str(line);
            out.push('\n');
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !wrote_port {
        out.push_str(&format!("server-port={}\n", params.port));
    }
    if !wrote_level_name {
        out.push_str("level-name=worlds/world\n");
    }
    fs::write(props_path, out.as_bytes())?;
    ensure_link(instance_dir, "server.properties")?;

    Ok(())
}
