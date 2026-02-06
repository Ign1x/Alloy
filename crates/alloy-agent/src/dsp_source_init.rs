use std::{
    collections::HashMap,
    fs,
    io::Read,
    path::{Component, Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};

use anyhow::Context;
use futures_util::StreamExt;
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::Mutex,
};

use crate::dsp;

const DSP_APP_ID: &str = "1366540";
const DSP_THUNDERSTORE_API: &str = "https://thunderstore.io/c/dyson-sphere-program/api/v1/package/";

const BUNDLED_PACKAGES: &[(&str, &str)] = &[
    ("xiaoye97-BepInEx", "5.4.17"),
    ("nebula-NebulaMultiplayerMod", "0.9.20"),
];

pub struct InitDspSourceResult {
    pub source_root: PathBuf,
    pub installed_packages: Vec<String>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ThunderPackage {
    owner: String,
    name: String,
    versions: Vec<ThunderVersion>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct ThunderVersion {
    version_number: String,
    download_url: String,
}

fn download_locks() -> &'static std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<std::sync::Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| std::sync::Mutex::new(HashMap::new()))
}

fn lock_for(key: &str) -> Arc<Mutex<()>> {
    let mut map = download_locks().lock().unwrap_or_else(|e| e.into_inner());
    map.entry(key.to_string())
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

fn http_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent("alloy-agent")
            .timeout(Duration::from_secs(30 * 60))
            .build()
            .expect("failed to build reqwest client")
    })
}

async fn download_to_path(url: &str, path: &Path) -> anyhow::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let resp = http_client()
        .get(url)
        .send()
        .await
        .with_context(|| format!("download {url}"))?
        .error_for_status()
        .with_context(|| format!("download {url} (status)"))?;

    let tmp = path.with_extension("tmp");
    let mut f = tokio::fs::File::create(&tmp).await?;
    let mut total: u64 = 0;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        total = total.saturating_add(chunk.len() as u64);
        if total > 2 * 1024 * 1024 * 1024_u64 {
            let _ = tokio::fs::remove_file(&tmp).await;
            anyhow::bail!("download too large");
        }
        tokio::io::AsyncWriteExt::write_all(&mut f, &chunk).await?;
    }
    tokio::io::AsyncWriteExt::flush(&mut f).await.ok();
    tokio::fs::rename(&tmp, path).await?;
    Ok(())
}

fn cache_dir() -> PathBuf {
    crate::minecraft::data_root()
        .join("cache")
        .join("dsp")
        .join("source-init")
}

fn steamcmd_dir() -> PathBuf {
    crate::minecraft::data_root().join("cache").join("steamcmd")
}

async fn ensure_steamcmd() -> anyhow::Result<PathBuf> {
    let dir = steamcmd_dir();
    let sh = dir.join("steamcmd.sh");
    if sh.exists() {
        return Ok(sh);
    }

    let lock = lock_for("steamcmd");
    let _guard = lock.lock().await;
    if sh.exists() {
        return Ok(sh);
    }

    tokio::fs::create_dir_all(&dir).await?;
    let tgz = dir.join("steamcmd_linux.tar.gz");
    download_to_path(
        "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz",
        &tgz,
    )
    .await
    .context("download steamcmd tar.gz")?;

    let status = Command::new("tar")
        .arg("-xzf")
        .arg(&tgz)
        .arg("-C")
        .arg(&dir)
        .status()
        .await
        .context("extract steamcmd (tar)")?;
    if !status.success() {
        anyhow::bail!("steamcmd extract failed (tar exit {})", status);
    }

    if !sh.exists() {
        anyhow::bail!("steamcmd.sh not found after extract");
    }
    Ok(sh)
}

struct TailBuffer {
    buf: Vec<u8>,
    cap: usize,
    start: usize,
    len: usize,
}

impl TailBuffer {
    fn new(cap: usize) -> Self {
        Self {
            buf: vec![0; cap.max(1)],
            cap: cap.max(1),
            start: 0,
            len: 0,
        }
    }

    fn push(&mut self, data: &[u8]) {
        if data.is_empty() {
            return;
        }
        if data.len() >= self.cap {
            self.buf.copy_from_slice(&data[data.len() - self.cap..]);
            self.start = 0;
            self.len = self.cap;
            return;
        }

        let total = self.len.saturating_add(data.len());
        if total > self.cap {
            let drop = total - self.cap;
            self.start = (self.start + drop) % self.cap;
            self.len = self.cap;
        } else {
            self.len = total;
        }

        let write_pos = (self.start + self.len - data.len()) % self.cap;
        let first = (self.cap - write_pos).min(data.len());
        self.buf[write_pos..write_pos + first].copy_from_slice(&data[..first]);
        if first < data.len() {
            self.buf[..data.len() - first].copy_from_slice(&data[first..]);
        }
    }

    fn to_vec(&self) -> Vec<u8> {
        if self.len == 0 {
            return Vec::new();
        }
        if self.start + self.len <= self.cap {
            return self.buf[self.start..self.start + self.len].to_vec();
        }
        let first = self.cap - self.start;
        let second = self.len - first;
        let mut out = Vec::with_capacity(self.len);
        out.extend_from_slice(&self.buf[self.start..]);
        out.extend_from_slice(&self.buf[..second]);
        out
    }
}

async fn read_tail<R: tokio::io::AsyncRead + Unpin>(
    mut reader: R,
    limit_bytes: usize,
) -> anyhow::Result<Vec<u8>> {
    let mut tail = TailBuffer::new(limit_bytes);
    let mut buf = [0u8; 8192];
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        tail.push(&buf[..n]);
    }
    Ok(tail.to_vec())
}

fn normalize_rel_path(rel: &str) -> anyhow::Result<PathBuf> {
    if rel.is_empty() {
        return Ok(PathBuf::new());
    }
    let p = Path::new(rel);
    if p.is_absolute() {
        anyhow::bail!("path must be relative");
    }

    let mut out = PathBuf::new();
    for c in p.components() {
        match c {
            Component::CurDir => {}
            Component::Normal(seg) => out.push(seg),
            Component::ParentDir => anyhow::bail!("path traversal is not allowed"),
            Component::Prefix(_) | Component::RootDir => anyhow::bail!("path must be relative"),
        }
    }
    Ok(out)
}

fn extract_zip_safely(zip_path: &Path, out_dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(out_dir)?;
    let f = fs::File::open(zip_path)?;
    let mut archive = zip::ZipArchive::new(f)?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)?;
        let name = file.name().to_string();
        let trimmed = name.trim_end_matches('/');
        if trimmed.is_empty() {
            continue;
        }
        let rel = normalize_rel_path(trimmed)
            .map_err(|e| anyhow::anyhow!("invalid zip path {trimmed:?}: {e}"))?;
        if rel.as_os_str().is_empty() {
            continue;
        }

        let out_path = out_dir.join(&rel);
        if name.ends_with('/') {
            fs::create_dir_all(&out_path)?;
            continue;
        }

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let tmp_path = out_path.with_extension("tmp");
        let mut out = fs::File::create(&tmp_path)?;
        std::io::copy(&mut file, &mut out)?;
        out.sync_all().ok();
        fs::rename(&tmp_path, &out_path)?;
    }

    Ok(())
}

fn thunder_package_name(id: &str) -> anyhow::Result<(&str, &str)> {
    let mut it = id.splitn(2, '-');
    let owner = it.next().unwrap_or_default().trim();
    let name = it.next().unwrap_or_default().trim();
    if owner.is_empty() || name.is_empty() {
        anyhow::bail!("invalid package id: {id}");
    }
    Ok((owner, name))
}

async fn fetch_thunder_packages() -> anyhow::Result<Vec<ThunderPackage>> {
    let resp = http_client()
        .get(DSP_THUNDERSTORE_API)
        .send()
        .await
        .context("fetch thunderstore package index")?
        .error_for_status()
        .context("fetch thunderstore package index (status)")?;
    let pkgs: Vec<ThunderPackage> = resp
        .json()
        .await
        .context("parse thunderstore package index")?;
    Ok(pkgs)
}

fn resolve_package_download_url(
    all: &[ThunderPackage],
    package_id: &str,
    version: Option<&str>,
) -> anyhow::Result<(String, String)> {
    let (owner, name) = thunder_package_name(package_id)?;
    let pkg = all
        .iter()
        .find(|p| p.owner.eq_ignore_ascii_case(owner) && p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| anyhow::anyhow!("package not found on thunderstore: {package_id}"))?;

    let ver = if let Some(v) = version {
        pkg.versions
            .iter()
            .find(|pv| pv.version_number == v)
            .ok_or_else(|| anyhow::anyhow!("package version not found: {package_id}-{v}"))?
    } else {
        pkg.versions
            .first()
            .ok_or_else(|| anyhow::anyhow!("package has no versions: {package_id}"))?
    };

    Ok((ver.download_url.clone(), ver.version_number.clone()))
}

fn plugin_dir(source_root: &Path) -> PathBuf {
    source_root.join("BepInEx").join("plugins")
}

fn install_package_from_zip(
    extract_root: &Path,
    package_id: &str,
    source_root: &Path,
) -> anyhow::Result<()> {
    let (_owner, name) = thunder_package_name(package_id)?;
    let candidates = [
        extract_root.join("plugins"),
        extract_root.join("BepInEx").join("plugins"),
        extract_root
            .join(package_id.replace('-', "_"))
            .join("plugins"),
        extract_root.join(name).join("plugins"),
    ];

    let src_plugins = candidates.iter().find(|p| p.is_dir()).cloned();
    let Some(src_plugins) = src_plugins else {
        anyhow::bail!("could not find plugins/ in extracted package: {package_id}");
    };

    let dst_plugins = plugin_dir(source_root);
    fs::create_dir_all(&dst_plugins)?;

    for entry in fs::read_dir(&src_plugins)? {
        let entry = entry?;
        let src = entry.path();
        let dst = dst_plugins.join(entry.file_name());
        if src.is_dir() {
            if dst.exists() {
                fs::remove_dir_all(&dst).ok();
            }
            fs::create_dir_all(&dst)?;
            for child in fs::read_dir(&src)? {
                let child = child?;
                let csrc = child.path();
                let cdst = dst.join(child.file_name());
                if csrc.is_dir() {
                    continue;
                }
                fs::copy(&csrc, &cdst)?;
            }
        } else {
            fs::copy(&src, &dst)?;
        }
    }

    Ok(())
}

async fn ensure_thunder_packages(source_root: &Path) -> anyhow::Result<Vec<String>> {
    let all = fetch_thunder_packages().await?;
    let cache = cache_dir().join("thunder");
    tokio::fs::create_dir_all(&cache).await?;
    let mut installed = Vec::<String>::new();

    for (package_id, pinned_version) in BUNDLED_PACKAGES {
        let (download_url, resolved_version) =
            resolve_package_download_url(&all, package_id, Some(pinned_version))?;
        let zip_path = cache.join(format!("{}-{}.zip", package_id.replace('-', "_"), resolved_version));
        if !zip_path.exists() {
            download_to_path(&download_url, &zip_path).await.with_context(|| {
                format!("download thunderstore package {package_id}-{resolved_version}")
            })?;
        }

        let extract_root = cache.join(format!("extract-{}-{}", package_id.replace('-', "_"), resolved_version));
        if extract_root.exists() {
            tokio::fs::remove_dir_all(&extract_root).await.ok();
        }
        extract_zip_safely(&zip_path, &extract_root)
            .with_context(|| format!("extract package {package_id}-{resolved_version}"))?;
        install_package_from_zip(&extract_root, package_id, source_root)
            .with_context(|| format!("install package {package_id}-{resolved_version}"))?;
        tokio::fs::remove_dir_all(&extract_root).await.ok();

        installed.push(format!("{package_id}-{resolved_version}"));
    }

    Ok(installed)
}

async fn run_steamcmd_with_tail(
    mut cmd: Command,
    context_action: &str,
) -> anyhow::Result<(std::process::ExitStatus, Vec<u8>, Vec<u8>)> {
    cmd.stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = cmd
        .spawn()
        .with_context(|| format!("spawn steamcmd ({context_action})"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    const TAIL_BYTES: usize = 64 * 1024;
    let stdout_task = stdout.map(|s| tokio::spawn(read_tail(s, TAIL_BYTES)));
    let stderr_task = stderr.map(|s| tokio::spawn(read_tail(s, TAIL_BYTES)));

    let status = child
        .wait()
        .await
        .with_context(|| format!("wait steamcmd ({context_action})"))?;
    let stdout_tail = match stdout_task {
        Some(h) => h.await.context("join steamcmd stdout")??,
        None => Vec::new(),
    };
    let stderr_tail = match stderr_task {
        Some(h) => h.await.context("join steamcmd stderr")??,
        None => Vec::new(),
    };

    Ok((status, stdout_tail, stderr_tail))
}

fn steamcmd_tail_to_text(stdout_tail: &[u8], stderr_tail: &[u8]) -> String {
    format!(
        "stdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(stdout_tail),
        String::from_utf8_lossy(stderr_tail)
    )
}

fn normalize_guard_code(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    if raw.is_empty() {
        return None;
    }
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        None
    } else {
        Some(compact)
    }
}

fn steamcmd_login_failed(lower: &str) -> bool {
    lower.contains("login failure")
        || lower.contains("invalid password")
        || lower.contains("account logon denied")
        || lower.contains("incorrect login")
}

fn steamcmd_guard_required(lower: &str) -> bool {
    lower.contains("this computer has not been authenticated")
        || lower.contains("steam guard code")
        || lower.contains("set_steam_guard_code")
        || lower.contains("two-factor")
        || lower.contains("2fa")
}

fn steamcmd_login_attempt_failed(status: std::process::ExitStatus, lower: &str) -> bool {
    !status.success() || steamcmd_login_failed(lower) || steamcmd_guard_required(lower)
}

fn steamcmd_home_dir() -> PathBuf {
    steamcmd_dir().join("home")
}

async fn ensure_steamcmd_runtime_dirs() -> anyhow::Result<()> {
    tokio::fs::create_dir_all(steamcmd_home_dir()).await?;
    Ok(())
}

pub async fn verify_steamcmd_login(
    steam_user: &str,
    steam_pass: &str,
    steam_guard_code: Option<&str>,
) -> anyhow::Result<()> {
    if steam_user.trim().is_empty() {
        anyhow::bail!("steam username is required");
    }
    if steam_pass.is_empty() {
        anyhow::bail!("steam password is required");
    }

    let guard_code = normalize_guard_code(steam_guard_code);

    let steamcmd_sh = ensure_steamcmd().await?;
    ensure_steamcmd_runtime_dirs().await?;

    let steamcmd_root = steamcmd_dir();
    let steamcmd_home = steamcmd_home_dir();

    let mut cmd = Command::new(&steamcmd_sh);
    cmd.current_dir(&steamcmd_root)
        .env("HOME", &steamcmd_home)
        .env("STEAMCMDDIR", &steamcmd_root);

    if let Some(code) = guard_code.as_deref() {
        cmd.arg("+set_steam_guard_code").arg(code);
    }

    cmd.arg("+login")
        .arg(steam_user)
        .arg(steam_pass)
        .arg("+quit");

    let (status, stdout_tail, stderr_tail) = run_steamcmd_with_tail(cmd, "verify login").await?;
    let tails = steamcmd_tail_to_text(&stdout_tail, &stderr_tail);
    let lower = tails.to_ascii_lowercase();

    if !steamcmd_login_attempt_failed(status, &lower) {
        return Ok(());
    }

    anyhow::bail!("steamcmd login failed:\n{}", tails);
}

async fn install_dsp_with_steamcmd(
    source_root: &Path,
    steam_user: &str,
    steam_pass: &str,
    steam_guard_code: Option<&str>,
) -> anyhow::Result<()> {
    let steamcmd_sh = ensure_steamcmd().await?;
    ensure_steamcmd_runtime_dirs().await?;
    tokio::fs::create_dir_all(source_root).await?;
    let guard_code = normalize_guard_code(steam_guard_code);

    let steamcmd_root = steamcmd_dir();
    let steamcmd_home = steamcmd_home_dir();

    let mut cmd = Command::new(&steamcmd_sh);
    cmd.current_dir(&steamcmd_root)
        .env("HOME", &steamcmd_home)
        .env("STEAMCMDDIR", &steamcmd_root)
        .arg("+force_install_dir")
        .arg(source_root);

    if let Some(code) = guard_code.as_deref() {
        cmd.arg("+set_steam_guard_code").arg(code);
    }

    cmd.arg("+login")
        .arg(steam_user)
        .arg(steam_pass)
        .arg("+app_update")
        .arg(DSP_APP_ID)
        .arg("validate")
        .arg("+quit");

    let (status, stdout_tail, stderr_tail) = run_steamcmd_with_tail(cmd, "install dsp").await?;
    let tails = steamcmd_tail_to_text(&stdout_tail, &stderr_tail);
    let lower = tails.to_ascii_lowercase();

    if !steamcmd_login_attempt_failed(status, &lower) {
        return Ok(());
    }

    anyhow::bail!("steamcmd failed:\n{}", tails);
}

fn file_magic_is_zip(path: &Path) -> bool {
    let mut f = match fs::File::open(path) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let mut header = [0u8; 4];
    let n = match f.read(&mut header) {
        Ok(v) => v,
        Err(_) => return false,
    };
    if n < header.len() {
        return false;
    }

    matches!(
        header,
        [b'P', b'K', 0x03, 0x04]
            | [b'P', b'K', 0x05, 0x06]
            | [b'P', b'K', 0x07, 0x08]
            | [b'P', b'K', 0x01, 0x02]
    )
}

pub async fn init_default_source(
    steam_user: &str,
    steam_pass: &str,
    steam_guard_code: Option<&str>,
) -> anyhow::Result<InitDspSourceResult> {
    if steam_user.trim().is_empty() {
        anyhow::bail!("steam username is required");
    }
    if steam_pass.is_empty() {
        anyhow::bail!("steam password is required");
    }

    let source_root = dsp::default_source_root();
    let lock = lock_for("dsp:source:init");
    let _guard = lock.lock().await;

    let errs = dsp::source_layout_errors(&source_root);
    if errs.is_empty() {
        return Ok(InitDspSourceResult {
            source_root,
            installed_packages: Vec::new(),
        });
    }

    if source_root.exists() {
        tokio::fs::remove_dir_all(&source_root).await.ok();
    }
    tokio::fs::create_dir_all(&source_root).await?;

    install_dsp_with_steamcmd(&source_root, steam_user, steam_pass, steam_guard_code)
        .await
        .context("install dsp via steamcmd")?;

    let exe = source_root.join("DSPGAME.exe");
    if !exe.is_file() {
        let fallback = source_root.join("game").join("DSPGAME.exe");
        if fallback.is_file() {
            fs::copy(&fallback, &exe)?;
        }
    }

    let installed_packages = ensure_thunder_packages(&source_root)
        .await
        .context("install nebula dependencies")?;

    let errs = dsp::source_layout_errors(&source_root);
    if !errs.is_empty() {
        anyhow::bail!(
            "initialized source is incomplete at {}: {}",
            source_root.display(),
            errs.join("; ")
        );
    }

    let bepinex_plugins = source_root.join("BepInEx").join("plugins");
    if !bepinex_plugins.is_dir() {
        anyhow::bail!("plugins directory missing at {}", bepinex_plugins.display());
    }

    for e in fs::read_dir(&bepinex_plugins).unwrap_or_else(|_| fs::read_dir(&bepinex_plugins).unwrap()) {
        let p = e?.path();
        if p.is_file() && file_magic_is_zip(&p) {
            anyhow::bail!(
                "plugin zip found in plugins directory (expected extracted files): {}",
                p.display()
            );
        }
    }

    Ok(InitDspSourceResult {
        source_root,
        installed_packages,
    })
}

