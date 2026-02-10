#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub const THE_FOREST_APP_ID: &str = "556450";

pub struct InstalledTheForestServer {
    pub server_root: PathBuf,
    pub launcher: PathBuf,
}

fn cache_dir() -> PathBuf {
    crate::the_forest::data_root()
        .join("cache")
        .join("the_forest")
        .join("vanilla")
}

fn find_launcher(install_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        install_dir.join("TheForestDedicatedServer.x86_64"),
        install_dir.join("TheForestDedicatedServer"),
        install_dir.join("start.sh"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("TheForestDedicatedServer")
            .join("TheForestDedicatedServer.x86_64"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("TheForestDedicatedServer")
            .join("start.sh"),
    ];
    crate::steam_download::find_launcher_with_fallback(
        install_dir,
        &candidates,
        &["TheForestDedicatedServer", "start.sh"],
    )
}

pub async fn ensure_the_forest_server() -> anyhow::Result<InstalledTheForestServer> {
    let cache = cache_dir();
    let out = crate::steam_download::ensure_steam_app_latest(
        THE_FOREST_APP_ID,
        &cache,
        "the_forest:vanilla:latest",
        find_launcher,
    )
    .await?;

    Ok(InstalledTheForestServer {
        server_root: out.server_root,
        launcher: out.launcher,
    })
}
