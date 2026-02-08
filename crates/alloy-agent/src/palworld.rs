use std::{collections::BTreeMap, fs, path::Path, path::PathBuf};

use anyhow::Context;

#[derive(Debug, Clone)]
pub struct VanillaParams {
    pub port: u16,
    pub query_port: u16,
    pub max_players: u32,
    pub server_name: String,
    pub server_description: String,
    pub password: Option<String>,
    pub admin_password: Option<String>,
    pub public: bool,
}

fn parse_port(
    raw: Option<&String>,
    default_value: u16,
    field_errors: &mut BTreeMap<String, String>,
    key: &str,
) -> u16 {
    match raw.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        None => default_value,
        Some(v) => match v.parse::<u16>() {
            Ok(0) => 0,
            Ok(p) if p >= 1024 => p,
            Ok(p) => {
                field_errors.insert(
                    key.to_string(),
                    format!("Must be 0 (auto) or in 1024..65535 (got {p})."),
                );
                p
            }
            Err(_) => {
                field_errors.insert(
                    key.to_string(),
                    "Must be an integer (0 for auto, or 1024..65535).".to_string(),
                );
                default_value
            }
        },
    }
}

fn parse_bool(raw: Option<&String>, default_value: bool) -> bool {
    match raw.map(|v| v.trim()).filter(|v| !v.is_empty()) {
        None => default_value,
        Some(v) if v.eq_ignore_ascii_case("true") || v == "1" || v.eq_ignore_ascii_case("yes") => {
            true
        }
        Some(v) if v.eq_ignore_ascii_case("false") || v == "0" || v.eq_ignore_ascii_case("no") => {
            false
        }
        Some(_) => default_value,
    }
}

fn ini_escape(value: &str) -> String {
    value.replace('\\', "\\\\").replace('"', "\\\"")
}

pub fn validate_vanilla_params(params: &BTreeMap<String, String>) -> anyhow::Result<VanillaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    let port = parse_port(params.get("port"), 8211, &mut field_errors, "port");
    let query_port = parse_port(
        params.get("query_port"),
        27015,
        &mut field_errors,
        "query_port",
    );

    let max_players = match params
        .get("max_players")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 32,
        Some(raw) => match raw.parse::<u32>() {
            Ok(v) => v,
            Err(_) => {
                field_errors.insert(
                    "max_players".to_string(),
                    "Must be an integer between 1 and 128.".to_string(),
                );
                32
            }
        },
    };
    if !(1..=128).contains(&max_players) {
        field_errors.insert(
            "max_players".to_string(),
            "Must be between 1 and 128.".to_string(),
        );
    }

    let server_name = params
        .get("server_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("Alloy Palworld server")
        .to_string();
    if server_name.is_empty() {
        field_errors.insert("server_name".to_string(), "Must be non-empty.".to_string());
    }

    let server_description = params
        .get("server_description")
        .map(|v| v.trim())
        .unwrap_or("")
        .to_string();

    let password = params
        .get("password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let admin_password = params
        .get("admin_password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    let public = parse_bool(params.get("public"), false);

    if !field_errors.is_empty() {
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            "invalid palworld params",
            Some(field_errors),
            Some("Fix the highlighted fields, then try again.".to_string()),
        ));
    }

    Ok(VanillaParams {
        port,
        query_port,
        max_players,
        server_name,
        server_description,
        password,
        admin_password,
        public,
    })
}

pub fn data_root() -> PathBuf {
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
    fs::create_dir_all(instance_dir.join("logs"))?;
    let user_dir = instance_dir.join("palworld-user");
    let user_cfg_dir = user_dir
        .join("Pal")
        .join("Saved")
        .join("Config")
        .join("LinuxServer");
    fs::create_dir_all(&user_cfg_dir)?;

    // Keep an instance-local settings file for auditable/runtime overrides.
    // Runtime launch still passes explicit CLI flags for ports/player count.
    let mut cfg = String::new();
    cfg.push_str("[/Script/Pal.PalGameWorldSettings]\n");
    cfg.push_str("OptionSettings=(");
    cfg.push_str("Difficulty=None,");
    cfg.push_str("DayTimeSpeedRate=1.000000,");
    cfg.push_str("NightTimeSpeedRate=1.000000,");
    cfg.push_str("ExpRate=1.000000,");
    cfg.push_str("PalCaptureRate=1.000000,");
    cfg.push_str("PalSpawnNumRate=1.000000,");
    cfg.push_str("PalDamageRateAttack=1.000000,");
    cfg.push_str("PalDamageRateDefense=1.000000,");
    cfg.push_str("PlayerDamageRateAttack=1.000000,");
    cfg.push_str("PlayerDamageRateDefense=1.000000,");
    cfg.push_str("PlayerStomachDecreaceRate=1.000000,");
    cfg.push_str("PlayerStaminaDecreaceRate=1.000000,");
    cfg.push_str("PlayerAutoHPRegeneRate=1.000000,");
    cfg.push_str("PlayerAutoHpRegeneRateInSleep=1.000000,");
    cfg.push_str("PalStomachDecreaceRate=1.000000,");
    cfg.push_str("PalStaminaDecreaceRate=1.000000,");
    cfg.push_str("PalAutoHPRegeneRate=1.000000,");
    cfg.push_str("PalAutoHpRegeneRateInSleep=1.000000,");
    cfg.push_str("BuildObjectDamageRate=1.000000,");
    cfg.push_str("BuildObjectDeteriorationDamageRate=1.000000,");
    cfg.push_str("CollectionDropRate=1.000000,");
    cfg.push_str("CollectionObjectHpRate=1.000000,");
    cfg.push_str("CollectionObjectRespawnSpeedRate=1.000000,");
    cfg.push_str("EnemyDropItemRate=1.000000,");
    cfg.push_str("DeathPenalty=All,");
    cfg.push_str("bEnablePlayerToPlayerDamage=False,");
    cfg.push_str("bEnableFriendlyFire=False,");
    cfg.push_str("bEnableInvaderEnemy=True,");
    cfg.push_str("bActiveUNKO=False,");
    cfg.push_str("bEnableAimAssistPad=True,");
    cfg.push_str("bEnableAimAssistKeyboard=False,");
    cfg.push_str("DropItemMaxNum=3000,");
    cfg.push_str("DropItemMaxNum_UNKO=100,");
    cfg.push_str("BaseCampMaxNum=128,");
    cfg.push_str("BaseCampWorkerMaxNum=15,");
    cfg.push_str("DropItemAliveMaxHours=1.000000,");
    cfg.push_str("bAutoResetGuildNoOnlinePlayers=False,");
    cfg.push_str("AutoResetGuildTimeNoOnlinePlayers=72.000000,");
    cfg.push_str("GuildPlayerMaxNum=20,");
    cfg.push_str(&format!(
        "PalEggDefaultHatchingTime=1.000000,ServerPlayerMaxNum={},",
        params.max_players
    ));
    cfg.push_str(&format!(
        "ServerName=\"{}\",",
        ini_escape(&params.server_name)
    ));
    cfg.push_str(&format!(
        "ServerDescription=\"{}\",",
        ini_escape(&params.server_description)
    ));
    cfg.push_str("AdminPassword=\"");
    if let Some(v) = &params.admin_password {
        cfg.push_str(&ini_escape(v));
    }
    cfg.push_str("\",");
    cfg.push_str("ServerPassword=\"");
    if let Some(v) = &params.password {
        cfg.push_str(&ini_escape(v));
    }
    cfg.push_str("\",");
    cfg.push_str(&format!("PublicPort={},", params.port));
    cfg.push_str("PublicIP=\"\",");
    cfg.push_str("RCONEnabled=False,");
    cfg.push_str("RCONPort=25575,");
    cfg.push_str("Region=\"\",");
    cfg.push_str("bUseAuth=True,");
    cfg.push_str("BanListURL=\"https://api.palworldgame.com/api/banlist.txt\")\n");

    fs::write(
        instance_dir.join("config").join("PalWorldSettings.ini"),
        cfg.as_bytes(),
    )?;
    fs::write(user_cfg_dir.join("PalWorldSettings.ini"), cfg.as_bytes())?;

    Ok(())
}

pub fn server_binary(server_root: &Path) -> PathBuf {
    server_root
        .join("Pal")
        .join("Binaries")
        .join("Linux")
        .join("PalServer-Linux-Shipping")
}

pub fn ensure_runtime_artifacts(server_root: &Path) -> anyhow::Result<PathBuf> {
    let binary = server_binary(server_root);
    if !binary.is_file() {
        anyhow::bail!("palworld server binary not found: {}", binary.display());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&binary)?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&binary, perms)?;
    }

    let linux_dir = binary
        .parent()
        .with_context(|| format!("resolve palworld binary dir: {}", binary.display()))?;
    let dst = linux_dir.join("steamclient.so");
    if !dst.is_file() {
        let candidates = [
            server_root.join("linux64").join("steamclient.so"),
            server_root.join("steamclient.so"),
        ];
        let src = candidates
            .into_iter()
            .find(|p| p.is_file())
            .with_context(|| format!("steamclient.so not found under {}", server_root.display()))?;
        std::fs::copy(&src, &dst)
            .with_context(|| format!("copy {} -> {}", src.display(), dst.display()))?;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&dst) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&dst, perms);
        }
    }

    Ok(binary)
}

pub fn ensure_instance_runtime_permissions(instance_dir: &Path) -> anyhow::Result<()> {
    #[cfg(unix)]
    {
        if unsafe { libc::geteuid() } != 0 {
            return Ok(());
        }

        let status = std::process::Command::new("chown")
            .arg("-R")
            .arg("1000:1000")
            .arg(instance_dir)
            .status()
            .with_context(|| format!("chown instance dir {}", instance_dir.display()))?;
        if !status.success() {
            anyhow::bail!(
                "failed to set instance ownership for palworld: {} (exit {})",
                instance_dir.display(),
                status
            );
        }
    }

    Ok(())
}

pub fn launch_args(params: &VanillaParams, user_dir: &Path) -> Vec<String> {
    let mut out = vec![
        "Pal".to_string(),
        "-useperfthreads".to_string(),
        "-NoAsyncLoadingThread".to_string(),
        "-UseMultithreadForDS".to_string(),
        "-log".to_string(),
        format!("-port={}", params.port),
        format!("-queryport={}", params.query_port),
        format!("-players={}", params.max_players),
        format!("-userdir={}", user_dir.display()),
    ];
    if params.public {
        out.push("-publiclobby".to_string());
    }
    out
}
