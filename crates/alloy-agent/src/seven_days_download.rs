#![allow(dead_code)]

use std::path::{Path, PathBuf};

pub const SEVEN_DAYS_APP_ID: &str = "294420";

pub struct InstalledSevenDaysServer {
    pub server_root: PathBuf,
    pub launcher: PathBuf,
}

fn cache_dir() -> PathBuf {
    crate::seven_days::data_root()
        .join("cache")
        .join("seven_days")
        .join("vanilla")
}

fn find_launcher(install_dir: &Path) -> Option<PathBuf> {
    let candidates = [
        install_dir.join("startserver.sh"),
        install_dir.join("startserver.sh.x86_64"),
        install_dir.join("7DaysToDieServer.x86_64"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("7 Days to Die Dedicated Server")
            .join("startserver.sh"),
        install_dir
            .join("steamapps")
            .join("common")
            .join("7 Days to Die Dedicated Server")
            .join("7DaysToDieServer.x86_64"),
    ];
    crate::steam_download::find_launcher_with_fallback(
        install_dir,
        &candidates,
        &["startserver.sh", "7DaysToDieServer"],
    )
}

pub async fn ensure_seven_days_server() -> anyhow::Result<InstalledSevenDaysServer> {
    let cache = cache_dir();
    let out = crate::steam_download::ensure_steam_app_latest(
        SEVEN_DAYS_APP_ID,
        &cache,
        "seven_days:vanilla:latest",
        find_launcher,
    )
    .await?;

    Ok(InstalledSevenDaysServer {
        server_root: out.server_root,
        launcher: out.launcher,
    })
}
