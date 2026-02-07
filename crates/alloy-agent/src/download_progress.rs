use std::{
    collections::HashMap,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[derive(Debug, Clone)]
pub struct WarmProgressSnapshot {
    pub stage: String,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_sec: u64,
    pub message: String,
    pub done: bool,
    pub updated_at_unix_ms: u64,
}

#[derive(Debug, Clone)]
struct WarmProgressEntry {
    snapshot: WarmProgressSnapshot,
}

fn now_unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn store() -> &'static Mutex<HashMap<String, WarmProgressEntry>> {
    static STORE: OnceLock<Mutex<HashMap<String, WarmProgressEntry>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cleanup_locked(map: &mut HashMap<String, WarmProgressEntry>) {
    let now = now_unix_ms();
    let stale_done_ms = Duration::from_secs(10 * 60).as_millis() as u64;
    let stale_any_ms = Duration::from_secs(60 * 60).as_millis() as u64;

    map.retain(|_, entry| {
        let age = now.saturating_sub(entry.snapshot.updated_at_unix_ms);
        if entry.snapshot.done {
            return age <= stale_done_ms;
        }
        age <= stale_any_ms
    });
}

pub fn start(progress_id: &str, stage: &str, message: impl Into<String>, total_bytes: Option<u64>) {
    let key = progress_id.trim();
    if key.is_empty() {
        return;
    }

    let mut map = store().lock().unwrap_or_else(|e| e.into_inner());
    cleanup_locked(&mut map);

    let now = now_unix_ms();
    map.insert(
        key.to_string(),
        WarmProgressEntry {
            snapshot: WarmProgressSnapshot {
                stage: stage.trim().to_string(),
                downloaded_bytes: 0,
                total_bytes: total_bytes.unwrap_or(0),
                speed_bytes_per_sec: 0,
                message: message.into(),
                done: false,
                updated_at_unix_ms: now,
            },
        },
    );
}

#[derive(Debug, Clone)]
pub struct UpdateArgs {
    pub stage: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_sec: Option<u64>,
    pub message: Option<String>,
    pub done: Option<bool>,
}

pub fn update(progress_id: &str, args: UpdateArgs) {
    let key = progress_id.trim();
    if key.is_empty() {
        return;
    }

    let mut map = store().lock().unwrap_or_else(|e| e.into_inner());
    cleanup_locked(&mut map);

    let now = now_unix_ms();
    let entry = map.entry(key.to_string()).or_insert_with(|| WarmProgressEntry {
        snapshot: WarmProgressSnapshot {
            stage: String::new(),
            downloaded_bytes: 0,
            total_bytes: 0,
            speed_bytes_per_sec: 0,
            message: String::new(),
            done: false,
            updated_at_unix_ms: now,
        },
    });

    if let Some(stage) = args.stage {
        entry.snapshot.stage = stage;
    }
    if let Some(downloaded) = args.downloaded_bytes {
        entry.snapshot.downloaded_bytes = downloaded;
    }
    if let Some(total) = args.total_bytes {
        entry.snapshot.total_bytes = total;
    }
    if let Some(speed) = args.speed_bytes_per_sec {
        entry.snapshot.speed_bytes_per_sec = speed;
    }
    if let Some(message) = args.message {
        entry.snapshot.message = message;
    }
    if let Some(done) = args.done {
        entry.snapshot.done = done;
        if done {
            entry.snapshot.speed_bytes_per_sec = 0;
        }
    }
    entry.snapshot.updated_at_unix_ms = now;
}

pub fn finish(
    progress_id: &str,
    message: impl Into<String>,
    downloaded_bytes: u64,
    total_bytes: u64,
    speed_bytes_per_sec: u64,
) {
    update(
        progress_id,
        UpdateArgs {
            stage: Some("ready".to_string()),
            downloaded_bytes: Some(downloaded_bytes),
            total_bytes: Some(total_bytes.max(downloaded_bytes)),
            speed_bytes_per_sec: Some(speed_bytes_per_sec),
            message: Some(message.into()),
            done: Some(true),
        },
    );
}

pub fn fail(progress_id: &str, message: impl Into<String>) {
    update(
        progress_id,
        UpdateArgs {
            stage: Some("error".to_string()),
            downloaded_bytes: None,
            total_bytes: None,
            speed_bytes_per_sec: Some(0),
            message: Some(message.into()),
            done: Some(true),
        },
    );
}

pub fn get(progress_id: &str) -> Option<WarmProgressSnapshot> {
    let key = progress_id.trim();
    if key.is_empty() {
        return None;
    }

    let mut map = store().lock().unwrap_or_else(|e| e.into_inner());
    cleanup_locked(&mut map);
    map.get(key).map(|v| v.snapshot.clone())
}
