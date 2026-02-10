#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub const SONS_OF_THE_FOREST_APP_ID: &str = "2465200";

pub struct InstalledSonsOfTheForestServer {
    pub server_root: PathBuf,
    pub launcher: PathBuf,
}

fn cache_dir() -> PathBuf {
    crate::sons_of_the_forest::data_root()
        .join("cache")
        .join("sons_of_the_forest")
        .join("vanilla")
}

fn find_launcher(install_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        install_dir.join("SonsOfTheForestDS"),
        install_dir.join("SonsOfTheForestDS.x86_64"),
        install_dir.join("start.sh"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("Sons Of The Forest Dedicated Server")
            .join("SonsOfTheForestDS"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("Sons Of The Forest Dedicated Server")
            .join("start.sh"),
    ];
    crate::steam_download::find_launcher_with_fallback(
        install_dir,
        &candidates,
        &["SonsOfTheForestDS", "start.sh"],
    )
}

pub async fn ensure_sons_of_the_forest_server() -> anyhow::Result<InstalledSonsOfTheForestServer> {
    let cache = cache_dir();
    let out = crate::steam_download::ensure_steam_app_latest(
        SONS_OF_THE_FOREST_APP_ID,
        &cache,
        "sons_of_the_forest:vanilla:latest",
        find_launcher,
    )
    .await?;

    Ok(InstalledSonsOfTheForestServer {
        server_root: out.server_root,
        launcher: out.launcher,
    })
}
