use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct LaunchSpec {
    pub exec: String,
    pub args: Vec<String>,
    pub kind: String,
}

fn write_alloy_jvm_args(instance_dir: &Path, memory_mb: u32) -> anyhow::Result<PathBuf> {
    let path = instance_dir.join("alloy_jvm_args.txt");
    let tmp = instance_dir.join("alloy_jvm_args.txt.tmp");
    let mut out = String::new();
    out.push_str(&format!("-Xmx{}M\n", memory_mb.max(256)));
    std::fs::write(&tmp, out.as_bytes())?;
    std::fs::rename(tmp, &path)?;
    Ok(path)
}

fn collect_named_files(root: &Path, file_name: &str, out: &mut Vec<PathBuf>) {
    let rd = match std::fs::read_dir(root) {
        Ok(v) => v,
        Err(_) => return,
    };
    for e in rd.flatten() {
        let path = e.path();
        let meta = match std::fs::symlink_metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        if meta.file_type().is_symlink() {
            continue;
        }
        if meta.is_dir() {
            collect_named_files(&path, file_name, out);
            continue;
        }
        if meta.is_file()
            && path
                .file_name()
                .and_then(|s| s.to_str())
                .is_some_and(|n| n == file_name)
        {
            out.push(path);
        }
    }
}

fn best_candidate(mut candidates: Vec<PathBuf>) -> Option<PathBuf> {
    if candidates.is_empty() {
        return None;
    }
    candidates.sort_by(|a, b| {
        let la = a.components().count();
        let lb = b.components().count();
        la.cmp(&lb)
            .then_with(|| a.to_string_lossy().cmp(&b.to_string_lossy()))
    });
    candidates.into_iter().next()
}

fn find_unix_args(instance_dir: &Path) -> Option<PathBuf> {
    // Forge/neoforge server packs typically place args under libraries/**/unix_args.txt.
    let mut out = Vec::<PathBuf>::new();
    let libs = instance_dir.join("libraries");
    if libs.is_dir() {
        collect_named_files(&libs, "unix_args.txt", &mut out);
    }
    if out.is_empty() {
        collect_named_files(instance_dir, "unix_args.txt", &mut out);
    }
    best_candidate(out)
}

fn to_rel_str(base: &Path, path: &Path) -> anyhow::Result<String> {
    let rel = path
        .strip_prefix(base)
        .map_err(|_| anyhow::anyhow!("path is outside instance dir"))?;
    let s = rel.to_string_lossy().to_string();
    if s.trim().is_empty() {
        anyhow::bail!("invalid relative path");
    }
    Ok(s)
}

pub fn resolve_launch_spec(instance_dir: &Path, memory_mb: u32) -> anyhow::Result<LaunchSpec> {
    let server_jar = instance_dir.join("server.jar");
    if server_jar.is_file() {
        return Ok(LaunchSpec {
            exec: "java".to_string(),
            args: vec![
                format!("-Xmx{}M", memory_mb),
                "-jar".to_string(),
                "server.jar".to_string(),
                "nogui".to_string(),
            ],
            kind: "jar".to_string(),
        });
    }

    if let Some(unix_args) = find_unix_args(instance_dir) {
        let user_jvm = instance_dir.join("user_jvm_args.txt");
        let alloy_jvm = write_alloy_jvm_args(instance_dir, memory_mb)?;

        let mut args = Vec::<String>::new();
        if user_jvm.is_file() {
            args.push(format!("@{}", to_rel_str(instance_dir, &user_jvm)?));
        }
        args.push(format!("@{}", to_rel_str(instance_dir, &alloy_jvm)?));
        args.push(format!("@{}", to_rel_str(instance_dir, &unix_args)?));
        args.push("nogui".to_string());

        return Ok(LaunchSpec {
            exec: "java".to_string(),
            args,
            kind: "args-file".to_string(),
        });
    }

    anyhow::bail!(
        "could not determine how to launch this server pack (expected server.jar or libraries/**/unix_args.txt)"
    );
}
