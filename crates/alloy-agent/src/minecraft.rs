use std::collections::BTreeMap;

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
