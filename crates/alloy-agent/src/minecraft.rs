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
    // EULA must be accepted explicitly (legal + UX).
    match params.get("accept_eula").map(|v| v.as_str()) {
        Some("true") => {}
        _ => anyhow::bail!("missing required param: accept_eula=true"),
    }

    let version = params
        .get("version")
        .cloned()
        .unwrap_or_else(|| "latest_release".to_string());

    let memory_mb = params
        .get("memory_mb")
        .map(|v| v.parse::<u32>())
        .transpose()
        .map_err(|_| anyhow::anyhow!("invalid memory_mb"))?
        .unwrap_or(2048);
    if !(512..=65536).contains(&memory_mb) {
        anyhow::bail!("memory_mb out of range: {memory_mb}");
    }

    let port = params
        .get("port")
        .map(|v| v.parse::<u16>())
        .transpose()
        .map_err(|_| anyhow::anyhow!("invalid port"))?
        .unwrap_or(25565);
    if port < 1024 {
        anyhow::bail!("port out of range: {port}");
    }

    Ok(VanillaParams {
        version,
        memory_mb,
        port,
    })
}

pub fn data_root() -> PathBuf {
    std::env::var("ALLOY_DATA_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("./data"))
}

pub fn instance_dir(process_id: &str) -> PathBuf {
    data_root().join("instances").join(process_id)
}

pub fn ensure_vanilla_instance_layout(
    instance_dir: &Path,
    params: &VanillaParams,
) -> anyhow::Result<()> {
    fs::create_dir_all(instance_dir)?;

    // EULA gate is handled by validate_vanilla_params(); writing eula=true is the
    // explicit acceptance action.
    fs::write(instance_dir.join("eula.txt"), b"eula=true\n")?;

    // Minimal `server.properties` management: ensure server-port is set.
    let props_path = instance_dir.join("server.properties");
    let existing = fs::read_to_string(&props_path).unwrap_or_default();
    let mut out = String::new();
    let mut wrote_port = false;
    for line in existing.lines() {
        if let Some((_k, _v)) = line.split_once('=')
            && line.starts_with("server-port=")
        {
            out.push_str(&format!("server-port={}\n", params.port));
            wrote_port = true;
            continue;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !wrote_port {
        out.push_str(&format!("server-port={}\n", params.port));
    }
    fs::write(props_path, out.as_bytes())?;

    Ok(())
}
