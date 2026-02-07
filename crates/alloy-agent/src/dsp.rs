use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupMode {
    Auto,
    LoadLatest,
    Load,
    NewGameDefault,
    NewGameCfg,
}

impl StartupMode {
    pub fn as_str(self) -> &'static str {
        match self {
            StartupMode::Auto => "auto",
            StartupMode::LoadLatest => "load_latest",
            StartupMode::Load => "load",
            StartupMode::NewGameDefault => "newgame_default",
            StartupMode::NewGameCfg => "newgame_cfg",
        }
    }
}

impl std::fmt::Display for StartupMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str((*self).as_str())
    }
}

#[derive(Debug, Clone)]
#[allow(dead_code)]
pub struct NebulaParams {
    pub server_root: PathBuf,
    pub port: u16,
    pub startup_mode: StartupMode,
    pub save_name: Option<String>,
    pub server_password: Option<String>,
    pub remote_access_password: Option<String>,
    pub auto_pause_enabled: bool,
    pub ups: u16,
    pub wine_bin: String,
}

#[derive(Debug, Clone)]
pub struct PreparedNebulaLaunch {
    pub launcher_script: PathBuf,
    pub effective_startup_mode: StartupMode,
    pub wine_bin: String,
}

const DEFAULT_SERVER_ROOT_REL: &str = "uploads/dsp/server";
const INSTANCE_SERVER_ROOT_DIR: &str = "server_root";

fn source_server_root(data_root: &Path) -> PathBuf {
    data_root.join(DEFAULT_SERVER_ROOT_REL)
}

fn instance_server_root(instance_dir: &Path) -> PathBuf {
    instance_dir.join(INSTANCE_SERVER_ROOT_DIR)
}

fn validate_server_root_layout(path: &Path) -> Vec<String> {
    let mut errs = Vec::<String>::new();
    if !path.is_dir() {
        errs.push(format!("Directory does not exist: {}", path.display()));
        return errs;
    }
    if !path.join("DSPGAME.exe").is_file() {
        errs.push("DSPGAME.exe not found. Install DSP + BepInEx + Nebula first.".to_string());
    }
    if !path.join("BepInEx").is_dir() {
        errs.push("BepInEx directory not found (Nebula server requires it).".to_string());
    }
    errs
}

pub fn default_source_root() -> PathBuf {
    source_server_root(&data_root())
}

pub fn source_layout_errors(path: &Path) -> Vec<String> {
    validate_server_root_layout(path)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
            continue;
        }
        if file_type.is_file() {
            fs::copy(&src_path, &dst_path)?;
            continue;
        }
        if file_type.is_symlink() {
            let target_meta = fs::metadata(&src_path)
                .map_err(|e| anyhow::anyhow!("failed to resolve symlink {}: {e}", src_path.display()))?;
            if target_meta.is_dir() {
                copy_dir_recursive(&src_path, &dst_path)?;
                continue;
            }
            if target_meta.is_file() {
                fs::copy(&src_path, &dst_path)?;
                continue;
            }

            anyhow::bail!(
                "unsupported symlink target type at {}",
                src_path.display()
            );
        }
    }
    Ok(())
}

fn materialize_instance_server_root(instance_dir: &Path, source_root: &Path) -> anyhow::Result<PathBuf> {
    let runtime_root = instance_server_root(instance_dir);
    if runtime_root.exists() {
        let errs = validate_server_root_layout(&runtime_root);
        if errs.is_empty() {
            return Ok(runtime_root);
        }
        anyhow::bail!(
            "instance server_root is invalid at {}: {}",
            runtime_root.display(),
            errs.join("; ")
        );
    }

    let tmp_root = instance_dir.join(format!("{}.tmp.{}", INSTANCE_SERVER_ROOT_DIR, std::process::id()));
    if tmp_root.exists() {
        let _ = fs::remove_dir_all(&tmp_root);
    }
    copy_dir_recursive(source_root, &tmp_root)?;
    match fs::rename(&tmp_root, &runtime_root) {
        Ok(()) => Ok(runtime_root),
        Err(e) => {
            let _ = fs::remove_dir_all(&tmp_root);
            if runtime_root.exists() {
                let errs = validate_server_root_layout(&runtime_root);
                if errs.is_empty() {
                    return Ok(runtime_root);
                }
            }
            Err(e).map_err(Into::into)
        }
    }
}

pub fn validate_nebula_params(params: &BTreeMap<String, String>) -> anyhow::Result<NebulaParams> {
    let mut field_errors = BTreeMap::<String, String>::new();

    let server_root = default_source_root();
    let server_root_abs = fs::canonicalize(&server_root).unwrap_or(server_root.clone());
    let server_root_errs = source_layout_errors(&server_root_abs);
    if !server_root_errs.is_empty() {
        field_errors.insert(
            "server_root".to_string(),
            format!(
                "Default DSP server files missing at {}: {}",
                server_root_abs.display(),
                server_root_errs.join("; ")
            ),
        );
    }

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

    let startup_mode = match params
        .get("startup_mode")
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .as_deref()
    {
        None => StartupMode::Auto,
        Some("auto") => StartupMode::Auto,
        Some("load_latest") | Some("load-latest") => StartupMode::LoadLatest,
        Some("load") => StartupMode::Load,
        Some("newgame_default") | Some("newgame-default") => StartupMode::NewGameDefault,
        Some("newgame_cfg") | Some("newgame-cfg") => StartupMode::NewGameCfg,
        Some(other) => {
            field_errors.insert(
                "startup_mode".to_string(),
                format!(
                    "Unknown startup mode: {other}. Use auto|load_latest|load|newgame_default|newgame_cfg."
                ),
            );
            StartupMode::Auto
        }
    };

    let save_name = params
        .get("save_name")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .map(|v| {
            if let Some(stripped) = v.strip_suffix(".dsv") {
                stripped.to_string()
            } else {
                v.to_string()
            }
        });
    if startup_mode == StartupMode::Load && save_name.is_none() {
        field_errors.insert(
            "save_name".to_string(),
            "Required when startup_mode=load. Provide an existing save name (without .dsv)."
                .to_string(),
        );
    }
    if let Some(name) = &save_name {
        if name.len() > 128 {
            field_errors.insert(
                "save_name".to_string(),
                "Must be 1..128 characters.".to_string(),
            );
        }
        if name.contains('/') || name.contains('\\') {
            field_errors.insert(
                "save_name".to_string(),
                "Must not contain path separators ('/' or '\\').".to_string(),
            );
        }
    }

    let server_password = params
        .get("server_password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if server_password
        .as_deref()
        .is_some_and(|v| v.contains('\n') || v.contains('\r'))
    {
        field_errors.insert(
            "server_password".to_string(),
            "Must not contain newlines.".to_string(),
        );
    }

    let remote_access_password = params
        .get("remote_access_password")
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());
    if remote_access_password
        .as_deref()
        .is_some_and(|v| v.contains('\n') || v.contains('\r'))
    {
        field_errors.insert(
            "remote_access_password".to_string(),
            "Must not contain newlines.".to_string(),
        );
    }

    let auto_pause_enabled = parse_bool_param(
        params.get("auto_pause_enabled"),
        false,
        "auto_pause_enabled",
        &mut field_errors,
    );

    let ups = match params
        .get("ups")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        None => 60,
        Some(raw) => match raw.parse::<u16>() {
            Ok(v) if (1..=240).contains(&v) => v,
            Ok(v) => {
                field_errors.insert("ups".to_string(), format!("Must be in 1..=240 (got {v})."));
                60
            }
            Err(_) => {
                field_errors.insert(
                    "ups".to_string(),
                    "Must be an integer (1..240).".to_string(),
                );
                60
            }
        },
    };

    let wine_bin = params
        .get("wine_bin")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .unwrap_or("wine64")
        .to_string();
    if wine_bin.contains('\n') || wine_bin.contains('\r') {
        field_errors.insert(
            "wine_bin".to_string(),
            "Must not contain newlines.".to_string(),
        );
    }

    if !field_errors.is_empty() {
        let source_missing = field_errors.contains_key("server_root");
        let message = if source_missing && field_errors.len() == 1 {
            "dsp source files are not initialized"
        } else {
            "invalid dsp params"
        };
        let hint = if source_missing {
            Some(
                "Open the DSP template in Create Instance, click Warm, and provide Steam credentials once to initialize /data/uploads/dsp/server.".to_string(),
            )
        } else {
            Some("Fix the highlighted fields, then try again.".to_string())
        };
        return Err(crate::error_payload::anyhow(
            "invalid_param",
            message,
            Some(field_errors),
            hint,
        ));
    }

    Ok(NebulaParams {
        server_root: server_root_abs,
        port,
        startup_mode,
        save_name,
        server_password,
        remote_access_password,
        auto_pause_enabled,
        ups,
        wine_bin,
    })
}

fn parse_bool_param(
    raw: Option<&String>,
    default_value: bool,
    key: &str,
    field_errors: &mut BTreeMap<String, String>,
) -> bool {
    match raw.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        None => default_value,
        Some(v) => match v.to_ascii_lowercase().as_str() {
            "true" | "1" | "yes" | "on" => true,
            "false" | "0" | "no" | "off" => false,
            _ => {
                field_errors.insert(
                    key.to_string(),
                    "Must be a boolean (true/false).".to_string(),
                );
                default_value
            }
        },
    }
}

pub fn data_root() -> PathBuf {
    crate::minecraft::data_root()
}

pub fn instance_dir(process_id: &str) -> PathBuf {
    data_root().join("instances").join(process_id)
}

pub fn ensure_nebula_instance_layout(instance_dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(instance_dir)?;
    fs::create_dir_all(instance_dir.join("config"))?;
    fs::create_dir_all(instance_dir.join("logs"))?;
    fs::create_dir_all(instance_dir.join("wineprefix"))?;
    Ok(())
}

pub fn prepare_nebula_launch(
    instance_dir: &Path,
    params: &NebulaParams,
    port: u16,
) -> anyhow::Result<PreparedNebulaLaunch> {
    ensure_nebula_instance_layout(instance_dir)?;

    let runtime_server_root = materialize_instance_server_root(instance_dir, &params.server_root)?;

    let wine_bin = if command_exists(&params.wine_bin) {
        params.wine_bin.clone()
    } else if params.wine_bin == "wine64" && command_exists("wine") {
        "wine".to_string()
    } else {
        anyhow::bail!(
            "wine executable not found in PATH: {} (tried fallback: wine)",
            params.wine_bin
        );
    };

    let config_path = runtime_server_root
        .join("BepInEx")
        .join("config")
        .join("nebula.cfg");
    write_nebula_config(&config_path, port, params)?;

    let wineprefix = fs::canonicalize(instance_dir.join("wineprefix"))
        .unwrap_or_else(|_| instance_dir.join("wineprefix"));
    let effective_startup_mode = match params.startup_mode {
        StartupMode::Auto => {
            if has_any_save_file(&wineprefix) {
                StartupMode::LoadLatest
            } else {
                StartupMode::NewGameDefault
            }
        }
        m => m,
    };

    let mut launch_args = vec![
        "-batchmode".to_string(),
        "-nographics".to_string(),
        "-popupwindow".to_string(),
        "-nebula-server".to_string(),
    ];
    match effective_startup_mode {
        StartupMode::Auto => {}
        StartupMode::LoadLatest => launch_args.push("-load-latest".to_string()),
        StartupMode::Load => {
            launch_args.push("-load".to_string());
            launch_args.push(params.save_name.clone().unwrap_or_default());
        }
        StartupMode::NewGameDefault => launch_args.push("-newgame-default".to_string()),
        StartupMode::NewGameCfg => launch_args.push("-newgame-cfg".to_string()),
    }
    launch_args.push("-ups".to_string());
    launch_args.push(params.ups.to_string());

    let launcher_script = instance_dir.join("config").join("launch-dsp.sh");
    let mut script = String::new();
    script.push_str("#!/usr/bin/env sh\n");
    script.push_str("set -eu\n");
    script.push_str(&format!(
        "export WINEPREFIX={}\n",
        shell_single_quote(&wineprefix.display().to_string())
    ));
    script.push_str("export WINEDLLOVERRIDES='winhttp=n,b'\n");
    script.push_str("export WINEDEBUG='-all'\n");
    script.push_str("mkdir -p \"$WINEPREFIX\"\n");
    script.push_str(&format!(
        "cd {}\n",
        shell_single_quote(&runtime_server_root.display().to_string())
    ));

    let mut cmd = vec![
        shell_single_quote(&wine_bin),
        shell_single_quote("DSPGAME.exe"),
    ];
    cmd.extend(launch_args.iter().map(|arg| shell_single_quote(arg)));
    script.push_str("exec ");
    script.push_str(&cmd.join(" "));
    script.push('\n');

    fs::write(&launcher_script, script.as_bytes())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = fs::metadata(&launcher_script)?.permissions();
        perms.set_mode(0o755);
        fs::set_permissions(&launcher_script, perms)?;
    }

    Ok(PreparedNebulaLaunch {
        launcher_script,
        effective_startup_mode,
        wine_bin,
    })
}

fn has_any_save_file(wineprefix: &Path) -> bool {
    let users_dir = wineprefix.join("drive_c").join("users");
    let Ok(rd) = fs::read_dir(users_dir) else {
        return false;
    };

    for user in rd.flatten() {
        let save_dir = user
            .path()
            .join("Documents")
            .join("Dyson Sphere Program")
            .join("Save");
        let Ok(saves) = fs::read_dir(save_dir) else {
            continue;
        };
        for entry in saves.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if !ft.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if file_name.ends_with(".dsv") {
                return true;
            }
        }
    }

    false
}

fn write_nebula_config(path: &Path, port: u16, params: &NebulaParams) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let existing = fs::read_to_string(path).unwrap_or_default();

    let mut values = BTreeMap::<String, String>::new();
    values.insert("HostPort".to_string(), port.to_string());
    values.insert(
        "ServerPassword".to_string(),
        params.server_password.clone().unwrap_or_default(),
    );
    values.insert(
        "RemoteAccessPassword".to_string(),
        params.remote_access_password.clone().unwrap_or_default(),
    );
    values.insert(
        "AutoPauseEnabled".to_string(),
        if params.auto_pause_enabled {
            "true".to_string()
        } else {
            "false".to_string()
        },
    );
    values.insert("EnableUPnpOrPmpSupport".to_string(), "false".to_string());

    let rendered = upsert_section_values(&existing, "Nebula - Settings", &values);
    fs::write(path, rendered.as_bytes())?;
    Ok(())
}

fn upsert_section_values(
    content: &str,
    section_name: &str,
    values: &BTreeMap<String, String>,
) -> String {
    let mut out = Vec::<String>::new();
    let mut in_target = false;
    let mut found_target = false;
    let mut seen = BTreeSet::<String>::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(name) = parse_section_header(trimmed) {
            if in_target {
                for (key, value) in values {
                    if !seen.contains(key) {
                        out.push(format!("{key} = {}", config_value(value)));
                        seen.insert(key.clone());
                    }
                }
            }
            in_target = name == section_name;
            if in_target {
                found_target = true;
            }
            out.push(line.to_string());
            continue;
        }

        if in_target
            && let Some(key) = parse_key(trimmed)
            && let Some(new_value) = values.get(key)
        {
            out.push(format!("{key} = {}", config_value(new_value)));
            seen.insert(key.to_string());
            continue;
        }

        out.push(line.to_string());
    }

    if in_target {
        for (key, value) in values {
            if !seen.contains(key) {
                out.push(format!("{key} = {}", config_value(value)));
            }
        }
    }

    if !found_target {
        if !out.is_empty() && !out.last().is_some_and(|v| v.trim().is_empty()) {
            out.push(String::new());
        }
        out.push(format!("[{section_name}]"));
        for (key, value) in values {
            out.push(format!("{key} = {}", config_value(value)));
        }
    }

    let mut rendered = out.join("\n");
    if !rendered.ends_with('\n') {
        rendered.push('\n');
    }
    rendered
}

fn parse_section_header(line: &str) -> Option<&str> {
    if !(line.starts_with('[') && line.ends_with(']')) {
        return None;
    }
    Some(line[1..line.len().saturating_sub(1)].trim())
}

fn parse_key(line: &str) -> Option<&str> {
    if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
        return None;
    }
    let (key, _value) = line.split_once('=')?;
    let key = key.trim();
    if key.is_empty() { None } else { Some(key) }
}

fn config_value(value: &str) -> String {
    if value.is_empty() {
        return "\"\"".to_string();
    }
    if value
        .chars()
        .all(|c| !c.is_control() && c != '\\' && c != '"' && c != '\n' && c != '\r')
    {
        return value.to_string();
    }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

fn shell_single_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\"'\"'"))
}

fn command_exists(bin: &str) -> bool {
    let path = Path::new(bin);
    if path.components().count() > 1 {
        return is_executable_file(path);
    }

    std::env::var_os("PATH")
        .map(|paths| {
            std::env::split_paths(&paths).any(|dir| {
                let candidate = dir.join(bin);
                is_executable_file(&candidate)
            })
        })
        .unwrap_or(false)
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(meta) = fs::metadata(path) else {
        return false;
    };
    if !meta.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        return meta.permissions().mode() & 0o111 != 0;
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use super::{copy_dir_recursive, source_server_root, upsert_section_values};
    use std::{
        collections::BTreeMap,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
        time::{SystemTime, UNIX_EPOCH},
    };

    fn temp_dir_for(test_name: &str) -> PathBuf {
        static COUNTER: AtomicU64 = AtomicU64::new(1);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let mut dir = std::env::temp_dir();
        dir.push(format!(
            "alloy-agent-dsp-{test_name}-{}-{n}-{ts}",
            std::process::id()
        ));
        dir
    }

    #[test]
    fn source_server_root_uses_default_path() {
        let data_root = Path::new("/data");
        assert_eq!(
            source_server_root(data_root),
            PathBuf::from("/data/uploads/dsp/server")
        );
    }

    #[test]
    fn upsert_section_values_inserts_when_missing() {
        let input = "[Other]\nFoo = 1\n";
        let mut values = BTreeMap::<String, String>::new();
        values.insert("HostPort".to_string(), "8469".to_string());
        values.insert("ServerPassword".to_string(), "secret".to_string());

        let output = upsert_section_values(input, "Nebula - Settings", &values);
        assert!(output.contains("[Nebula - Settings]"));
        assert!(output.contains("HostPort = 8469"));
        assert!(output.contains("ServerPassword = secret"));
    }

    #[test]
    fn upsert_section_values_replaces_existing_keys() {
        let input = "[Nebula - Settings]\nHostPort = 1234\nServerPassword = old\n";
        let mut values = BTreeMap::<String, String>::new();
        values.insert("HostPort".to_string(), "8469".to_string());
        values.insert("ServerPassword".to_string(), "new".to_string());

        let output = upsert_section_values(input, "Nebula - Settings", &values);
        assert!(output.contains("HostPort = 8469"));
        assert!(output.contains("ServerPassword = new"));
        assert!(!output.contains("HostPort = 1234"));
    }

    #[test]
    fn upsert_section_values_quotes_empty_passwords() {
        let input = "[Nebula - Settings]\nHostPort = 1234\n";
        let mut values = BTreeMap::<String, String>::new();
        values.insert("HostPort".to_string(), "8469".to_string());
        values.insert("ServerPassword".to_string(), "".to_string());

        let output = upsert_section_values(input, "Nebula - Settings", &values);
        assert!(output.contains("HostPort = 8469"));
        assert!(output.contains("ServerPassword = \"\""));
    }

    #[cfg(unix)]
    #[test]
    fn copy_dir_recursive_follows_symlinked_directory() {
        let root = temp_dir_for("copy-dir-symlink-dir");
        let src = root.join("src");
        let dst = root.join("dst");
        let real = root.join("real");
        let nested = real.join("nested");

        std::fs::create_dir_all(&src).unwrap();
        std::fs::create_dir_all(&nested).unwrap();
        std::fs::write(nested.join("flag.txt"), b"ok").unwrap();
        std::os::unix::fs::symlink(&real, src.join("linked-dir")).unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        let copied = dst.join("linked-dir").join("nested").join("flag.txt");
        assert_eq!(std::fs::read(copied).unwrap(), b"ok");

        let _ = std::fs::remove_dir_all(&root);
    }
}
