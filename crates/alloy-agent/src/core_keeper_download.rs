#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub const CORE_KEEPER_APP_ID: &str = "1963720";

pub struct InstalledCoreKeeperServer {
    pub server_root: PathBuf,
    pub launcher: PathBuf,
}

fn cache_dir() -> PathBuf {
    crate::core_keeper::data_root()
        .join("cache")
        .join("core_keeper")
        .join("vanilla")
}

fn find_launcher(install_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        install_dir.join("CoreKeeperServer"),
        install_dir.join("CoreKeeperServer.x86_64"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("Core Keeper Dedicated Server")
            .join("CoreKeeperServer"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("Core Keeper Dedicated Server")
            .join("CoreKeeperServer.x86_64"),
    ];
    crate::steam_download::find_launcher_with_fallback(
        install_dir,
        &candidates,
        &["CoreKeeperServer"],
    )
}

pub async fn ensure_core_keeper_server() -> anyhow::Result<InstalledCoreKeeperServer> {
    let cache = cache_dir();
    let out = crate::steam_download::ensure_steam_app_latest(
        CORE_KEEPER_APP_ID,
        &cache,
        "core_keeper:vanilla:latest",
        find_launcher,
    )
    .await?;

    Ok(InstalledCoreKeeperServer {
        server_root: out.server_root,
        launcher: out.launcher,
    })
}
