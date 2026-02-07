use std::{
    collections::{BTreeMap, BTreeSet},
    io,
    path::{Path, PathBuf},
};

use anyhow::Context;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mode {
    Native,
    Bwrap,
    Docker,
}

#[derive(Clone, Debug)]
pub struct SandboxLimits {
    pub memory_bytes: u64,
    pub pids_limit: u64,
    pub nofile_limit: u64,
    pub cpu_millicores: u64,
}

impl SandboxLimits {
    pub fn summary(&self) -> String {
        let mem_mb = if self.memory_bytes == 0 {
            "unlimited".to_string()
        } else {
            format!("{}MiB", self.memory_bytes / (1024 * 1024))
        };
        let pids = if self.pids_limit == 0 {
            "unlimited".to_string()
        } else {
            self.pids_limit.to_string()
        };
        let nofile = if self.nofile_limit == 0 {
            "unlimited".to_string()
        } else {
            self.nofile_limit.to_string()
        };
        let cpu = if self.cpu_millicores == 0 {
            "unlimited".to_string()
        } else {
            format!("{}m", self.cpu_millicores)
        };

        format!("mem={mem_mb} pids={pids} nofile={nofile} cpu={cpu}")
    }

    pub fn apply_pre_exec(&self) -> io::Result<()> {
        #[cfg(target_os = "linux")]
        {
            fn set_rlimit(resource: libc::__rlimit_resource_t, limit: u64) -> io::Result<()> {
                let lim = libc::rlimit {
                    rlim_cur: limit as libc::rlim_t,
                    rlim_max: limit as libc::rlim_t,
                };
                let rc = unsafe { libc::setrlimit(resource, &lim) };
                if rc == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            }

            // Never keep core dumps for game processes.
            set_rlimit(libc::RLIMIT_CORE, 0)?;

            // Least privilege: child process tree cannot gain new privileges
            // (e.g. via setuid binaries).
            let rc = unsafe { libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) };
            if rc == -1 {
                return Err(io::Error::last_os_error());
            }

            if self.memory_bytes > 0 {
                set_rlimit(libc::RLIMIT_AS, self.memory_bytes)?;
            }
            if self.pids_limit > 0 {
                set_rlimit(libc::RLIMIT_NPROC, self.pids_limit)?;
            }
            if self.nofile_limit > 0 {
                set_rlimit(libc::RLIMIT_NOFILE, self.nofile_limit)?;
            }
        }

        Ok(())
    }
}

#[derive(Clone, Debug)]
pub struct SandboxLaunch {
    pub exec: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub limits: SandboxLimits,
    mode: Mode,
    container_name: Option<String>,
    cgroup_path: Option<PathBuf>,
    warnings: Vec<String>,
}

impl SandboxLaunch {
    pub fn summary(&self) -> String {
        let mode = match self.mode {
            Mode::Native => "native",
            Mode::Bwrap => "bwrap",
            Mode::Docker => "docker",
        };
        let container = self.container_name.as_deref().unwrap_or("-");
        if self.cgroup_path.is_some() {
            format!(
                "mode={mode} container={container} {} cgroup=on",
                self.limits.summary()
            )
        } else {
            format!(
                "mode={mode} container={container} {} cgroup=off",
                self.limits.summary()
            )
        }
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    pub fn container_name(&self) -> Option<&str> {
        self.container_name.as_deref()
    }

    pub fn is_docker_mode(&self) -> bool {
        matches!(self.mode, Mode::Docker)
    }

    pub fn should_apply_host_limits(&self) -> bool {
        !self.is_docker_mode()
    }

    pub fn attach_pid(&self, pid: u32) -> Option<String> {
        #[cfg(target_os = "linux")]
        {
            let Some(path) = &self.cgroup_path else {
                return None;
            };

            let procs = path.join("cgroup.procs");
            if let Err(e) = std::fs::write(&procs, format!("{pid}\n")) {
                return Some(format!(
                    "failed to attach pid {} to cgroup {}: {}",
                    pid,
                    path.display(),
                    e
                ));
            }
        }

        None
    }
}

fn env_u64(name: &str) -> Option<u64> {
    std::env::var(name).ok().and_then(|v| v.parse::<u64>().ok())
}

fn env_bool(name: &str, default_value: bool) -> bool {
    match std::env::var(name)
        .ok()
        .map(|v| v.trim().to_ascii_lowercase())
        .as_deref()
    {
        Some("1") | Some("true") | Some("yes") | Some("on") => true,
        Some("0") | Some("false") | Some("no") | Some("off") => false,
        _ => default_value,
    }
}

fn parse_bool_param(raw: Option<&str>, default_value: bool) -> bool {
    match raw
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .as_deref()
    {
        Some("1") | Some("true") | Some("yes") | Some("on") => true,
        Some("0") | Some("false") | Some("no") | Some("off") => false,
        _ => default_value,
    }
}

fn parse_u64_param(params: &BTreeMap<String, String>, key: &str) -> Option<u64> {
    params
        .get(key)
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
        .and_then(|v| v.parse::<u64>().ok())
}

fn parse_string_param<'a>(params: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    params.get(key).map(|v| v.trim()).filter(|v| !v.is_empty())
}

fn choose_mode(
    sandbox_enabled: bool,
    mode_override: Option<&str>,
) -> anyhow::Result<(Mode, Vec<String>)> {
    let mut warnings = Vec::<String>::new();

    let forced = std::env::var("ALLOY_SANDBOX_FORCE_MODE")
        .ok()
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty());

    if let Some(mode) = forced.as_deref() {
        return match mode {
            "native" => Ok((Mode::Native, warnings)),
            "bwrap" => {
                if command_exists("bwrap") {
                    Ok((Mode::Bwrap, warnings))
                } else {
                    anyhow::bail!(
                        "ALLOY_SANDBOX_FORCE_MODE=bwrap set, but `bwrap` is not found in PATH"
                    )
                }
            }
            "docker" => {
                if command_exists("docker") {
                    Ok((Mode::Docker, warnings))
                } else {
                    anyhow::bail!(
                        "ALLOY_SANDBOX_FORCE_MODE=docker set, but `docker` is not found in PATH"
                    )
                }
            }
            other => {
                anyhow::bail!("invalid ALLOY_SANDBOX_FORCE_MODE={other:?}")
            }
        };
    }

    if !sandbox_enabled {
        return Ok((Mode::Native, warnings));
    }

    if mode_override.is_none()
        && parse_bool_param(
            std::env::var("ALLOY_SANDBOX_DOCKER_ENABLED")
                .ok()
                .as_deref(),
            false,
        )
    {
        if command_exists("docker") {
            return Ok((Mode::Docker, warnings));
        }
        warnings.push(
            "sandbox docker mode requested, but `docker` not found; falling back to configured mode"
                .to_string(),
        );
    }

    let mode = mode_override
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            std::env::var("ALLOY_SANDBOX_MODE")
                .unwrap_or_else(|_| "auto".to_string())
                .trim()
                .to_ascii_lowercase()
        });

    match mode.as_str() {
        "off" | "disabled" => Ok((Mode::Native, warnings)),
        "native" => Ok((Mode::Native, warnings)),
        "docker" => {
            if command_exists("docker") {
                Ok((Mode::Docker, warnings))
            } else {
                anyhow::bail!(
                    "sandbox mode requires `docker`, but it was not found in PATH (set sandbox_mode/native or ALLOY_SANDBOX_MODE=native to disable container wrapper)"
                );
            }
        }
        "bwrap" => {
            if command_exists("bwrap") {
                Ok((Mode::Bwrap, warnings))
            } else {
                anyhow::bail!(
                    "sandbox mode requires `bwrap`, but it was not found in PATH (set sandbox_mode/native or ALLOY_SANDBOX_MODE=native to disable container wrapper)"
                );
            }
        }
        "auto" => {
            if command_exists("docker") {
                Ok((Mode::Docker, warnings))
            } else if command_exists("bwrap") {
                Ok((Mode::Bwrap, warnings))
            } else {
                warnings.push(
                    "sandbox container wrapper unavailable: neither `docker` nor `bwrap` found, falling back to native launch".to_string(),
                );
                Ok((Mode::Native, warnings))
            }
        }
        other => {
            if mode_override.is_some() {
                warnings.push(format!(
                    "unknown sandbox_mode={other:?}, falling back to auto"
                ));
            } else {
                warnings.push(format!(
                    "unknown ALLOY_SANDBOX_MODE={other:?}, falling back to auto"
                ));
            }
            if command_exists("docker") {
                Ok((Mode::Docker, warnings))
            } else if command_exists("bwrap") {
                Ok((Mode::Bwrap, warnings))
            } else {
                warnings.push(
                    "sandbox container wrapper unavailable: neither `docker` nor `bwrap` found, falling back to native launch".to_string(),
                );
                Ok((Mode::Native, warnings))
            }
        }
    }
}

fn resolve_limits(params: &BTreeMap<String, String>) -> SandboxLimits {
    let default_memory_mb = env_u64("ALLOY_SANDBOX_MEMORY_MB_DEFAULT")
        .map(|v| v.clamp(256, 131_072))
        .unwrap_or(4096);

    let default_pids = env_u64("ALLOY_SANDBOX_PIDS_LIMIT_DEFAULT")
        .map(|v| v.clamp(32, 32_768))
        .unwrap_or(512);

    let default_nofile = env_u64("ALLOY_SANDBOX_NOFILE_LIMIT_DEFAULT")
        .map(|v| v.clamp(256, 1_048_576))
        .unwrap_or(8192);

    let default_cpu_m = env_u64("ALLOY_SANDBOX_CPU_MILLICORES_DEFAULT")
        .map(|v| v.clamp(100, 64_000))
        .unwrap_or(2000);

    let memory_mb = parse_u64_param(params, "sandbox_memory_mb")
        .map(|v| if v == 0 { 0 } else { v.clamp(256, 131_072) })
        .unwrap_or(default_memory_mb);
    let pids_limit = parse_u64_param(params, "sandbox_pids_limit")
        .map(|v| if v == 0 { 0 } else { v.clamp(32, 32_768) })
        .unwrap_or(default_pids);
    let nofile_limit = parse_u64_param(params, "sandbox_nofile_limit")
        .map(|v| if v == 0 { 0 } else { v.clamp(256, 1_048_576) })
        .unwrap_or(default_nofile);
    let cpu_millicores = parse_u64_param(params, "sandbox_cpu_millicores")
        .map(|v| if v == 0 { 0 } else { v.clamp(100, 64_000) })
        .unwrap_or(default_cpu_m);

    SandboxLimits {
        memory_bytes: memory_mb.saturating_mul(1024 * 1024),
        pids_limit,
        nofile_limit,
        cpu_millicores,
    }
}

fn normalize_path(path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(path)
    }
}

fn build_bwrap_args(
    instance_dir: &Path,
    cwd: &Path,
    exec: &str,
    args: &[String],
    extra_rw_paths: &[PathBuf],
) -> anyhow::Result<Vec<String>> {
    let mut out = vec![
        "--die-with-parent".to_string(),
        "--new-session".to_string(),
        "--unshare-ipc".to_string(),
        "--unshare-pid".to_string(),
        "--unshare-uts".to_string(),
        "--unshare-user-try".to_string(),
        "--uid".to_string(),
        "0".to_string(),
        "--gid".to_string(),
        "0".to_string(),
        "--ro-bind".to_string(),
        "/".to_string(),
        "/".to_string(),
        "--proc".to_string(),
        "/proc".to_string(),
        "--dev".to_string(),
        "/dev".to_string(),
        "--tmpfs".to_string(),
        "/tmp".to_string(),
        "--tmpfs".to_string(),
        "/run".to_string(),
    ];

    let instance_dir = normalize_path(instance_dir);
    let cwd = normalize_path(cwd);

    let mut rw_paths = BTreeSet::<PathBuf>::new();
    rw_paths.insert(instance_dir.clone());
    rw_paths.insert(cwd.clone());
    for p in extra_rw_paths {
        rw_paths.insert(normalize_path(p));
    }

    for p in rw_paths {
        if !p.exists() {
            continue;
        }

        let p = p.display().to_string();
        out.push("--bind".to_string());
        out.push(p.clone());
        out.push(p);
    }

    if let Ok(path) = std::env::var("PATH") {
        out.push("--setenv".to_string());
        out.push("PATH".to_string());
        out.push(path);
    }
    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        out.push("--setenv".to_string());
        out.push("JAVA_HOME".to_string());
        out.push(java_home);
    }
    if let Ok(ld_library_path) = std::env::var("LD_LIBRARY_PATH") {
        out.push("--setenv".to_string());
        out.push("LD_LIBRARY_PATH".to_string());
        out.push(ld_library_path);
    }
    if let Ok(alloy_data_root) = std::env::var("ALLOY_DATA_ROOT") {
        out.push("--setenv".to_string());
        out.push("ALLOY_DATA_ROOT".to_string());
        out.push(alloy_data_root);
    }

    out.push("--setenv".to_string());
    out.push("HOME".to_string());
    out.push(instance_dir.display().to_string());

    out.push("--chdir".to_string());
    out.push(cwd.display().to_string());

    out.push("--".to_string());
    out.push(exec.to_string());
    out.extend(args.iter().cloned());

    Ok(out)
}

fn docker_container_name(process_id: &str) -> String {
    format!("alloy-inst-{}", sanitize_cgroup_name(process_id))
}

fn docker_image() -> String {
    std::env::var("ALLOY_SANDBOX_DOCKER_IMAGE")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| "ghcr.io/ign1x/alloy-agent:latest".to_string())
}

fn host_mount_path(path: &Path) -> Option<PathBuf> {
    let normalized = normalize_path(path);
    if let Ok(mountinfo) = std::fs::read_to_string("/proc/self/mountinfo") {
        return resolve_host_mount_path_from_mountinfo(&mountinfo, &normalized);
    }

    Some(std::fs::canonicalize(&normalized).unwrap_or(normalized))
}

fn mountpoint_prefix_matches(target: &str, mount_point: &str) -> bool {
    if target == mount_point {
        return true;
    }
    if mount_point == "/" {
        return target.starts_with('/');
    }
    target
        .strip_prefix(mount_point)
        .is_some_and(|rest| rest.starts_with('/'))
}

fn mount_path_from_mountinfo(mount_root: &str, mount_point: &str, target: &str) -> Option<PathBuf> {
    if !mountpoint_prefix_matches(target, mount_point) {
        return None;
    }

    let suffix = if target == mount_point {
        ""
    } else if mount_point == "/" {
        target.strip_prefix('/')?
    } else {
        target.strip_prefix(mount_point)?.strip_prefix('/')?
    };

    let mut out = PathBuf::from(mount_root);
    if !suffix.is_empty() {
        out.push(suffix);
    }
    Some(out)
}

fn resolve_host_mount_path_from_mountinfo(mountinfo: &str, path: &Path) -> Option<PathBuf> {
    let target = normalize_path(path).to_string_lossy().to_string();
    let mut best: Option<(usize, String, String, String)> = None;

    for line in mountinfo.lines() {
        let Some((left, right)) = line.split_once(" - ") else {
            continue;
        };
        let left_fields: Vec<&str> = left.split_whitespace().collect();
        if left_fields.len() < 5 {
            continue;
        }
        let right_fields: Vec<&str> = right.split_whitespace().collect();
        if right_fields.is_empty() {
            continue;
        }

        let mount_root = left_fields[3];
        let mount_point = left_fields[4];
        let fs_type = right_fields[0];

        if !mountpoint_prefix_matches(&target, mount_point) {
            continue;
        }

        let rank = mount_point.len();
        if best
            .as_ref()
            .map(|(best_rank, _, _, _)| rank > *best_rank)
            .unwrap_or(true)
        {
            best = Some((
                rank,
                mount_root.to_string(),
                mount_point.to_string(),
                fs_type.to_string(),
            ));
        }
    }

    let (_, mount_root, mount_point, fs_type) = best?;
    if fs_type == "overlay" {
        return None;
    }

    mount_path_from_mountinfo(&mount_root, &mount_point, &target)
}

fn extract_docker_volume_from_mount_root(mount_root: &str) -> Option<String> {
    let marker = "/var/lib/docker/volumes/";
    let idx = mount_root.find(marker)?;
    let rest = &mount_root[idx + marker.len()..];
    let (name, _suffix) = rest.split_once("/_data")?;
    if name.is_empty() || name.contains('/') {
        return None;
    }
    Some(name.to_string())
}

fn detect_docker_data_volume_from_mountinfo(mountinfo: &str, data_root: &Path) -> Option<String> {
    let target = normalize_path(data_root).to_string_lossy().to_string();
    let mut best: Option<(usize, String)> = None;

    for line in mountinfo.lines() {
        let left = line.split_once(" - ").map(|(v, _)| v).unwrap_or(line);
        let fields: Vec<&str> = left.split_whitespace().collect();
        if fields.len() < 5 {
            continue;
        }
        let mount_root = fields[3];
        let mount_point = fields[4];
        if !mountpoint_prefix_matches(&target, mount_point) {
            continue;
        }

        let Some(volume_name) = extract_docker_volume_from_mount_root(mount_root) else {
            continue;
        };
        let rank = mount_point.len();
        if best
            .as_ref()
            .map(|(best_rank, _)| rank > *best_rank)
            .unwrap_or(true)
        {
            best = Some((rank, volume_name));
        }
    }

    best.map(|(_, volume_name)| volume_name)
}

fn detect_docker_data_volume(data_root: &Path) -> Option<String> {
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo").ok()?;
    detect_docker_data_volume_from_mountinfo(&mountinfo, data_root)
}

fn docker_env_allowlist(params: &BTreeMap<String, String>) -> BTreeSet<String> {
    let mut out = BTreeSet::<String>::new();

    for k in [
        "PATH",
        "JAVA_HOME",
        "LD_LIBRARY_PATH",
        "ALLOY_DATA_ROOT",
        "TERM",
        "WINEPREFIX",
        "WINEDLLOVERRIDES",
        "WINEDEBUG",
    ] {
        out.insert(k.to_string());
    }

    if let Some(raw) = parse_string_param(params, "sandbox_env_allow") {
        for key in raw.split(',') {
            let k = key.trim();
            if k.is_empty() {
                continue;
            }
            if k.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_') {
                out.insert(k.to_string());
            }
        }
    }

    out
}

fn maybe_add_docker_env(args: &mut Vec<String>, key: &str) {
    if let Ok(val) = std::env::var(key)
        && !val.is_empty()
    {
        args.push("--env".to_string());
        args.push(format!("{key}={val}"));
    }
}

fn ensure_docker_ready(image: &str, docker_data_volume: Option<&str>) -> anyhow::Result<()> {
    let socket_path = std::env::var("ALLOY_SANDBOX_DOCKER_SOCKET")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| "/var/run/docker.sock".to_string());
    let socket = Path::new(&socket_path);
    if !socket.exists() {
        anyhow::bail!(
            "docker sandbox requires {} (mount docker socket into alloy-agent container)",
            socket.display()
        );
    }

    if let Some(volume_name) = docker_data_volume {
        let inspect = std::process::Command::new("docker")
            .env_remove("DOCKER_API_VERSION")
            .arg("volume")
            .arg("inspect")
            .arg(volume_name)
            .output()
            .with_context(|| format!("inspect docker volume {volume_name}"))?;
        if !inspect.status.success() {
            let create = std::process::Command::new("docker")
                .env_remove("DOCKER_API_VERSION")
                .arg("volume")
                .arg("create")
                .arg(volume_name)
                .output()
                .with_context(|| format!("create docker volume {volume_name}"))?;
            if !create.status.success() {
                let stderr = String::from_utf8_lossy(&create.stderr);
                anyhow::bail!(
                    "docker sandbox preflight failed to create volume {}: {}",
                    volume_name,
                    stderr.trim().to_string()
                );
            }
        }
    }

    let image_check = std::process::Command::new("docker")
        .env_remove("DOCKER_API_VERSION")
        .arg("image")
        .arg("inspect")
        .arg(image)
        .output()
        .with_context(|| format!("inspect docker image {image}"))?;
    if !image_check.status.success() {
        let pull = std::process::Command::new("docker")
            .env_remove("DOCKER_API_VERSION")
            .arg("pull")
            .arg(image)
            .output()
            .with_context(|| format!("pull docker image {image}"))?;
        if !pull.status.success() {
            let stderr = String::from_utf8_lossy(&pull.stderr);
            anyhow::bail!(
                "docker sandbox preflight failed to pull image {}: {}",
                image,
                stderr.trim().to_string()
            );
        }
    }

    Ok(())
}

fn build_docker_args(
    process_id: &str,
    params: &BTreeMap<String, String>,
    limits: &SandboxLimits,
    instance_dir: &Path,
    cwd: &Path,
    exec: &str,
    args: &[String],
    extra_rw_paths: &[PathBuf],
) -> anyhow::Result<Vec<String>> {
    let mut out = Vec::<String>::new();
    let image = docker_image();
    let cname = docker_container_name(process_id);

    out.push("run".to_string());
    out.push("--rm".to_string());
    out.push("--init".to_string());
    out.push("--interactive".to_string());
    out.push("--network".to_string());
    out.push("host".to_string());
    out.push("--name".to_string());
    out.push(cname);

    out.push("--security-opt".to_string());
    out.push("no-new-privileges:true".to_string());
    out.push("--cap-drop".to_string());
    out.push("ALL".to_string());
    out.push("--read-only".to_string());
    out.push("--tmpfs".to_string());
    out.push("/tmp:rw,nosuid,nodev,size=512m".to_string());
    out.push("--tmpfs".to_string());
    out.push("/run:rw,nosuid,nodev,size=64m".to_string());

    if limits.pids_limit > 0 {
        out.push("--pids-limit".to_string());
        out.push(limits.pids_limit.to_string());
    }
    if limits.memory_bytes > 0 {
        out.push("--memory".to_string());
        out.push(limits.memory_bytes.to_string());
    }
    if limits.cpu_millicores > 0 {
        out.push("--cpus".to_string());
        out.push(format!("{:.3}", limits.cpu_millicores as f64 / 1000.0));
    }
    if limits.nofile_limit > 0 {
        out.push("--ulimit".to_string());
        out.push(format!("nofile={0}:{0}", limits.nofile_limit));
    }

    let data_root = std::env::var("ALLOY_DATA_ROOT")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/data"));
    let data_root = normalize_path(&data_root);

    let configured_docker_data_volume = std::env::var("ALLOY_SANDBOX_DOCKER_DATA_VOLUME")
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty());

    let docker_data_volume =
        detect_docker_data_volume(&data_root).or(configured_docker_data_volume);

    ensure_docker_ready(&image, docker_data_volume.as_deref())?;

    if let Some(volume_name) = docker_data_volume.as_deref() {
        out.push("--mount".to_string());
        out.push(format!(
            "type=volume,source={volume_name},target={}",
            data_root.display()
        ));
    }

    let mut requested_rw_paths = BTreeSet::<PathBuf>::new();
    requested_rw_paths.insert(normalize_path(instance_dir));
    requested_rw_paths.insert(normalize_path(cwd));
    for p in extra_rw_paths {
        requested_rw_paths.insert(normalize_path(p));
    }
    if docker_data_volume.is_none() {
        requested_rw_paths.insert(data_root.clone());
    }

    let mut rw_paths = BTreeSet::<PathBuf>::new();
    for raw_path in requested_rw_paths {
        if docker_data_volume.is_some() && raw_path.starts_with(&data_root) {
            continue;
        }
        if !raw_path.exists() {
            continue;
        }
        let Some(host_path) = host_mount_path(&raw_path) else {
            continue;
        };
        rw_paths.insert(host_path);
    }

    for p in rw_paths {
        let p = p.display().to_string();
        out.push("--mount".to_string());
        out.push(format!("type=bind,source={p},target={p}"));
    }

    let env_allow = docker_env_allowlist(params);
    for key in env_allow {
        maybe_add_docker_env(&mut out, &key);
    }
    out.push("--env".to_string());
    out.push(format!("HOME={}", normalize_path(instance_dir).display()));

    out.push("--label".to_string());
    out.push(format!("alloy.process_id={process_id}"));
    out.push("--label".to_string());
    out.push("alloy.managed_by=alloy-agent".to_string());

    out.push("--workdir".to_string());
    out.push(normalize_path(cwd).display().to_string());

    out.push("--entrypoint".to_string());
    out.push(exec.to_string());

    out.push(image);
    out.extend(args.iter().cloned());

    Ok(out)
}

fn sanitize_cgroup_name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for ch in raw.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "instance".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::{
        detect_docker_data_volume_from_mountinfo, extract_docker_volume_from_mount_root,
        mount_path_from_mountinfo, mountpoint_prefix_matches,
        resolve_host_mount_path_from_mountinfo,
    };
    use std::path::Path;

    #[test]
    fn mountpoint_prefix_matching_works() {
        assert!(mountpoint_prefix_matches("/data", "/data"));
        assert!(mountpoint_prefix_matches("/data/instances/abc", "/data"));
        assert!(!mountpoint_prefix_matches("/database", "/data"));
    }

    #[test]
    fn extract_volume_name_from_mount_root() {
        let root = "/var/lib/docker/volumes/alloy_alloy-agent-data/_data";
        assert_eq!(
            extract_docker_volume_from_mount_root(root),
            Some("alloy_alloy-agent-data".to_string())
        );
    }

    #[test]
    fn detect_volume_prefers_longest_matching_mountpoint() {
        let mountinfo = r#"
425 411 0:27 /@/var/lib/docker/volumes/alloy_alloy-agent-data/_data /data rw,relatime - btrfs /dev/sdb3 rw
426 411 0:27 /@/var/lib/docker/volumes/other/_data / rw,relatime - btrfs /dev/sdb3 rw
"#;
        let got = detect_docker_data_volume_from_mountinfo(mountinfo, Path::new("/data"));
        assert_eq!(got, Some("alloy_alloy-agent-data".to_string()));
    }

    #[test]
    fn detect_volume_for_instance_subdir() {
        let mountinfo = r#"
425 411 0:27 /@/var/lib/docker/volumes/alloy_alloy-agent-data/_data /data rw,relatime - btrfs /dev/sdb3 rw
"#;
        let got = detect_docker_data_volume_from_mountinfo(
            mountinfo,
            Path::new("/data/instances/23cb6f2a-2bb7-4af4-a4cf-4d54c7fa95c7"),
        );
        assert_eq!(got, Some("alloy_alloy-agent-data".to_string()));
    }

    #[test]
    fn mount_path_from_mountinfo_handles_root_and_subpaths() {
        assert_eq!(
            mount_path_from_mountinfo("/", "/", "/tmp/work"),
            Some(Path::new("/tmp/work").to_path_buf())
        );
        assert_eq!(
            mount_path_from_mountinfo("/@/home/ign1x/Code/Alloy", "/app", "/app/crates"),
            Some(Path::new("/@/home/ign1x/Code/Alloy/crates").to_path_buf())
        );
    }

    #[test]
    fn resolve_host_mount_path_skips_overlay_only_paths() {
        let mountinfo = r#"
100 90 0:59 / / rw,relatime - overlay overlay rw,lowerdir=/layers
"#;
        let got = resolve_host_mount_path_from_mountinfo(mountinfo, Path::new("/app"));
        assert_eq!(got, None);
    }

    #[test]
    fn resolve_host_mount_path_maps_bind_mount_subpaths() {
        let mountinfo = r#"
100 90 0:59 / / rw,relatime - overlay overlay rw,lowerdir=/layers
101 100 0:27 /@/home/ign1x/Code/Alloy /app rw,relatime - btrfs /dev/sdb3 rw
"#;
        let got = resolve_host_mount_path_from_mountinfo(mountinfo, Path::new("/app/crates"));
        assert_eq!(
            got,
            Some(Path::new("/@/home/ign1x/Code/Alloy/crates").to_path_buf())
        );
    }
}

#[cfg(target_os = "linux")]
fn try_prepare_cgroup(process_id: &str, limits: &SandboxLimits) -> Result<Option<PathBuf>, String> {
    if !env_bool("ALLOY_SANDBOX_ENABLE_CGROUPS", true) {
        return Ok(None);
    }

    let root = PathBuf::from(
        std::env::var("ALLOY_SANDBOX_CGROUP_ROOT").unwrap_or_else(|_| "/sys/fs/cgroup".to_string()),
    );
    let prefix = std::env::var("ALLOY_SANDBOX_CGROUP_PREFIX")
        .unwrap_or_else(|_| "alloy.instance".to_string());
    let name = sanitize_cgroup_name(process_id);
    let path = root.join(format!("{prefix}.{name}"));

    if let Err(e) = std::fs::create_dir(&path)
        && e.kind() != io::ErrorKind::AlreadyExists
    {
        return Err(format!("create cgroup {}: {}", path.display(), e));
    }

    if limits.memory_bytes > 0
        && let Err(e) = std::fs::write(
            path.join("memory.max"),
            format!("{}\n", limits.memory_bytes),
        )
    {
        return Err(format!("configure memory.max in {}: {}", path.display(), e));
    }

    if limits.pids_limit > 0
        && let Err(e) = std::fs::write(path.join("pids.max"), format!("{}\n", limits.pids_limit))
    {
        return Err(format!("configure pids.max in {}: {}", path.display(), e));
    }

    if limits.cpu_millicores > 0 {
        let period: u64 = 100_000;
        let quota = ((period as u128 * limits.cpu_millicores as u128) / 1000)
            .max(1000)
            .min(u64::MAX as u128) as u64;
        if let Err(e) = std::fs::write(path.join("cpu.max"), format!("{} {}\n", quota, period)) {
            return Err(format!("configure cpu.max in {}: {}", path.display(), e));
        }
    }

    Ok(Some(path))
}

#[cfg(not(target_os = "linux"))]
fn try_prepare_cgroup(
    _process_id: &str,
    _limits: &SandboxLimits,
) -> Result<Option<PathBuf>, String> {
    Ok(None)
}

pub fn prepare_launch(
    process_id: &str,
    template_id: &str,
    params: &BTreeMap<String, String>,
    instance_dir: &Path,
    cwd: &Path,
    exec: &str,
    args: &[String],
    extra_rw_paths: &[PathBuf],
) -> anyhow::Result<SandboxLaunch> {
    let sandbox_enabled = parse_bool_param(
        params.get("sandbox_enabled").map(String::as_str),
        env_bool("ALLOY_SANDBOX_DEFAULT_ENABLED", true),
    );

    let mode_override = parse_string_param(params, "sandbox_mode");
    let (mode, mut warnings) = choose_mode(sandbox_enabled, mode_override)?;
    let limits = resolve_limits(params);

    let mut cgroup_path = None;
    if sandbox_enabled && !matches!(mode, Mode::Docker) {
        match try_prepare_cgroup(process_id, &limits) {
            Ok(v) => cgroup_path = v,
            Err(e) => warnings.push(format!("cgroup limits unavailable: {e}")),
        }
    }

    let cwd = normalize_path(cwd);

    let (cmd_exec, cmd_args) = match mode {
        Mode::Native => (exec.to_string(), args.to_vec()),
        Mode::Bwrap => (
            "bwrap".to_string(),
            build_bwrap_args(instance_dir, &cwd, exec, args, extra_rw_paths)
                .with_context(|| format!("build bwrap launch for process_id={process_id}"))?,
        ),
        Mode::Docker => {
            let docker_args = build_docker_args(
                process_id,
                params,
                &limits,
                instance_dir,
                &cwd,
                exec,
                args,
                extra_rw_paths,
            )
            .with_context(|| {
                format!(
                    "build docker launch for process_id={} template_id={template_id}",
                    process_id
                )
            })?;
            ("docker".to_string(), docker_args)
        }
    };

    let container_name = if matches!(mode, Mode::Docker) {
        Some(docker_container_name(process_id))
    } else {
        None
    };

    Ok(SandboxLaunch {
        exec: cmd_exec,
        args: cmd_args,
        cwd,
        limits,
        mode,
        container_name,
        cgroup_path,
        warnings,
    })
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
    let Ok(meta) = std::fs::metadata(path) else {
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
