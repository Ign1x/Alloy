use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

#[derive(Debug, Clone, Default)]
pub struct VanillaParams;

pub fn validate_vanilla_params(
    _params: &BTreeMap<String, String>,
) -> anyhow::Result<VanillaParams> {
    Ok(VanillaParams)
}

pub fn data_root() -> PathBuf {
    crate::minecraft::data_root()
}

pub fn instance_dir(process_id: &str) -> PathBuf {
    data_root().join("instances").join(process_id)
}

pub fn ensure_vanilla_instance_layout(instance_dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(instance_dir)?;
    fs::create_dir_all(instance_dir.join("logs"))?;
    fs::create_dir_all(instance_dir.join("config"))?;
    fs::create_dir_all(instance_dir.join("data"))?;
    Ok(())
}
