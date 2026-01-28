package scheduler

import (
  "context"
  "encoding/json"
  "errors"
  "fmt"
  "log"
  "math"
  "os"
  "path/filepath"
  "sort"
  "strings"
  "time"

  "elegantmc/daemon/internal/backup"
  "elegantmc/daemon/internal/mc"
  "elegantmc/daemon/internal/sandbox"
)

// InstanceBackupScheduler polls per-instance .elegantmc.json for backup_schedule.
// It is intentionally separate from schedule.json tasks to keep the global scheduler stable.
type InstanceBackupScheduler struct {
  cfg  InstanceBackupSchedulerConfig
  deps InstanceBackupSchedulerDeps
}

type InstanceBackupSchedulerConfig struct {
  Enabled   bool
  PollEvery time.Duration

  // Safety caps.
  MaxInstances int
}

type InstanceBackupSchedulerDeps struct {
  ServersFS *sandbox.FS
  MC        *mc.Manager
  Log       *log.Logger
}

func NewInstanceBackupScheduler(cfg InstanceBackupSchedulerConfig, deps InstanceBackupSchedulerDeps) *InstanceBackupScheduler {
  if cfg.PollEvery <= 0 {
    cfg.PollEvery = 30 * time.Second
  }
  if cfg.MaxInstances <= 0 {
    cfg.MaxInstances = 200
  }
  return &InstanceBackupScheduler{cfg: cfg, deps: deps}
}

func (m *InstanceBackupScheduler) Run(ctx context.Context) {
  if !m.cfg.Enabled {
    return
  }
  if m.deps.ServersFS == nil {
    m.logf("instance-backup-scheduler: disabled (servers fs missing)")
    return
  }

  ticker := time.NewTicker(m.cfg.PollEvery)
  defer ticker.Stop()

  // Run once quickly on start.
  m.tick(ctx)

  for {
    select {
    case <-ctx.Done():
      return
    case <-ticker.C:
      m.tick(ctx)
    }
  }
}

func (m *InstanceBackupScheduler) tick(ctx context.Context) {
  root := m.deps.ServersFS.Root()
  entries, err := os.ReadDir(root)
  if err != nil {
    m.logf("instance-backup-scheduler: list servers failed: %v", err)
    return
  }

  var ids []string
  for _, ent := range entries {
    if ent == nil || !ent.IsDir() {
      continue
    }
    name := strings.TrimSpace(ent.Name())
    if name == "" {
      continue
    }
    if strings.HasPrefix(name, ".") || strings.HasPrefix(name, "_") {
      continue
    }
    ids = append(ids, name)
    if len(ids) >= m.cfg.MaxInstances {
      break
    }
  }
  sort.Strings(ids)

  for _, id := range ids {
    select {
    case <-ctx.Done():
      return
    default:
    }
    if err := m.tickInstance(ctx, id); err != nil {
      // Best-effort: log and keep going.
      m.logf("instance-backup-scheduler: instance=%s tick failed: %v", id, err)
    }
  }
}

func (m *InstanceBackupScheduler) tickInstance(ctx context.Context, instanceID string) error {
  cfgAbs, err := m.deps.ServersFS.Resolve(filepath.Join(instanceID, ".elegantmc.json"))
  if err != nil {
    return err
  }

  b, err := os.ReadFile(cfgAbs)
  if err != nil {
    if errors.Is(err, os.ErrNotExist) {
      return nil
    }
    return err
  }
  if len(b) > 2*1024*1024 {
    return errors.New("instance config too large")
  }

  var cfg map[string]any
  if err := json.Unmarshal(b, &cfg); err != nil {
    return errors.New("invalid instance config (.elegantmc.json)")
  }

  schedRaw, ok := cfg["backup_schedule"]
  sched, okMap := schedRaw.(map[string]any)
  if !ok || !okMap {
    return nil
  }

  enabled, _ := asBoolAny(sched["enabled"])
  if !enabled {
    return nil
  }

  everySec, _ := asInt64Any(sched["every_sec"])
  if everySec <= 0 {
    return nil
  }
  if everySec < 60 {
    everySec = 60
  }

  stop := true
  if v, ok := asBoolAny(sched["stop"]); ok {
    stop = v
  }

  format := strings.TrimSpace(strings.ToLower(asStringAny(sched["format"])))
  if format == "tgz" {
    format = "tar.gz"
  }
  if format != "zip" && format != "tar.gz" {
    // Default aligns with the Panel's manual backup default.
    format = "tar.gz"
  }

  keepLast, _ := asInt64Any(cfg["backup_retention_keep_last"])
  if keepLast < 0 {
    keepLast = 0
  }
  if keepLast > 1000 {
    keepLast = 1000
  }

  status := map[string]any{}
  if raw, ok := cfg["backup_schedule_status"]; ok {
    if mm, ok2 := raw.(map[string]any); ok2 {
      status = mm
    }
  }

  nowUnix := time.Now().Unix()
  lastRunUnix, _ := asInt64Any(status["last_run_unix"])

  // If this schedule was just enabled and never ran, anchor it to now so it won't fire immediately.
  if lastRunUnix <= 0 {
    status["last_run_unix"] = nowUnix
    status["last_error"] = ""
    cfg["backup_schedule_status"] = status
    return writeJSONAtomic(cfgAbs, cfg)
  }

  if nowUnix-lastRunUnix < everySec {
    return nil
  }

  // Mark started.
  status["last_started_unix"] = nowUnix
  status["last_error"] = ""
  cfg["backup_schedule_status"] = status
  _ = writeJSONAtomic(cfgAbs, cfg)

  // Backup work.
  err = m.runScheduledBackup(ctx, instanceID, format, stop, int(keepLast), status)

  // Persist result.
  finishedUnix := time.Now().Unix()
  status["last_finished_unix"] = finishedUnix
  status["last_run_unix"] = finishedUnix
  if err != nil {
    status["last_error"] = err.Error()
  } else {
    status["last_error"] = ""
    status["last_success_unix"] = finishedUnix
  }
  cfg["backup_schedule_status"] = status
  return writeJSONAtomic(cfgAbs, cfg)
}

func (m *InstanceBackupScheduler) runScheduledBackup(ctx context.Context, instanceID string, format string, stop bool, keepLast int, status map[string]any) error {
  if m.deps.ServersFS == nil {
    return errors.New("daemon misconfigured: servers fs missing")
  }
  if strings.TrimSpace(instanceID) == "" {
    return errors.New("instance_id is required")
  }

  if stop && m.deps.MC != nil {
    _ = m.deps.MC.Stop(ctx, instanceID)
  }

  srcAbs, err := m.deps.ServersFS.Resolve(instanceID)
  if err != nil {
    return err
  }
  if _, err := os.Stat(srcAbs); err != nil {
    return err
  }

  nowUnix := time.Now().Unix()
  ext := "zip"
  if format == "tar.gz" {
    ext = "tar.gz"
  }
  backupName := fmt.Sprintf("%s-scheduled-%d.%s", instanceID, nowUnix, ext)
  destRel := filepath.Join("_backups", instanceID, backupName)
  destAbs, err := m.deps.ServersFS.Resolve(destRel)
  if err != nil {
    return err
  }
  if err := os.MkdirAll(filepath.Dir(destAbs), 0o755); err != nil {
    return err
  }

  files := 0
  var bytes int64
  if format == "tar.gz" {
    n, b, err := backup.TarGzDir(srcAbs, destAbs, nil)
    if err != nil {
      return err
    }
    files = n
    bytes = b
  } else {
    n, err := backup.ZipDir(srcAbs, destAbs)
    if err != nil {
      return err
    }
    files = n
  }

  // Best-effort file size.
  if st, err := os.Stat(destAbs); err == nil && st != nil && st.Size() > 0 {
    bytes = st.Size()
  }

  // Best-effort metadata sidecar for Panel restore points view.
  meta := map[string]any{
    "schema":          1,
    "instance_id":     instanceID,
    "path":            filepath.ToSlash(destRel),
    "backup_name":     backupName,
    "format":          format,
    "created_at_unix": nowUnix,
    "files":           files,
    "bytes":           bytes,
    "comment":         "scheduled",
  }
  if b, err := json.MarshalIndent(meta, "", "  "); err == nil {
    b = append(b, '\n')
    _ = os.WriteFile(destAbs+".meta.json", b, 0o600)
  }

  // Remember last path for UI.
  status["last_backup_path"] = filepath.ToSlash(destRel)

  if keepLast > 0 {
    if keepLast > 1000 {
      keepLast = 1000
    }
    _ = pruneBackupArchives(filepath.Dir(destAbs), keepLast)
  }
  return nil
}

type backupArchiveFile struct {
  name  string
  abs   string
  mtime time.Time
}

func pruneBackupArchives(dirAbs string, keepLast int) error {
  if keepLast < 1 {
    return nil
  }
  entries, err := os.ReadDir(dirAbs)
  if err != nil {
    return err
  }
  var files []backupArchiveFile
  for _, ent := range entries {
    if ent == nil || ent.IsDir() {
      continue
    }
    name := ent.Name()
    lower := strings.ToLower(name)
    if !strings.HasSuffix(lower, ".zip") && !strings.HasSuffix(lower, ".tar.gz") && !strings.HasSuffix(lower, ".tgz") {
      continue
    }
    info, err := ent.Info()
    if err != nil {
      continue
    }
    files = append(files, backupArchiveFile{name: name, abs: filepath.Join(dirAbs, name), mtime: info.ModTime()})
  }
  sort.Slice(files, func(i, j int) bool {
    if files[i].mtime.Equal(files[j].mtime) {
      return files[i].name > files[j].name
    }
    return files[i].mtime.After(files[j].mtime)
  })
  if len(files) <= keepLast {
    return nil
  }
  for i := keepLast; i < len(files); i++ {
    _ = os.Remove(files[i].abs)
    _ = os.Remove(files[i].abs + ".meta.json")
  }
  return nil
}

func writeJSONAtomic(path string, v any) error {
  b, err := json.MarshalIndent(v, "", "  ")
  if err != nil {
    return err
  }
  b = append(b, '\n')
  if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
    return err
  }
  tmp := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
  if err := os.WriteFile(tmp, b, 0o600); err != nil {
    return err
  }
  return os.Rename(tmp, path)
}

func (m *InstanceBackupScheduler) logf(format string, args ...any) {
  if m.deps.Log != nil {
    m.deps.Log.Printf(format, args...)
    return
  }
  log.Printf(format, args...)
}

func asBoolAny(v any) (bool, bool) {
  if v == nil {
    return false, false
  }
  if b, ok := v.(bool); ok {
    return b, true
  }
  return false, false
}

func asInt64Any(v any) (int64, bool) {
  if v == nil {
    return 0, false
  }
  switch t := v.(type) {
  case int:
    return int64(t), true
  case int64:
    return t, true
  case float64:
    if !isFinite(t) {
      return 0, false
    }
    return int64(math.Round(t)), true
  default:
    return 0, false
  }
}

func asStringAny(v any) string {
  if v == nil {
    return ""
  }
  if s, ok := v.(string); ok {
    return s
  }
  return ""
}

func isFinite(f float64) bool {
  return !math.IsNaN(f) && !math.IsInf(f, 0)
}
