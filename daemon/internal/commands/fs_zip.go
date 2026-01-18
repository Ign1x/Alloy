package commands

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"elegantmc/daemon/internal/backup"
	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) fsZip(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	_ = ctx

	path, _ := asString(cmd.Args["path"])
	zipPath, _ := asString(cmd.Args["zip_path"])
	path = strings.TrimSpace(path)
	zipPath = strings.TrimSpace(zipPath)

	if path == "" {
		return fail("path is required")
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	srcAbs, err := e.deps.FS.Resolve(path)
	if err != nil {
		return fail(err.Error())
	}
	if filepath.Clean(srcAbs) == filepath.Clean(e.deps.FS.Root()) {
		return fail("refuse to zip root")
	}
	info, err := os.Stat(srcAbs)
	if err != nil {
		if os.IsNotExist(err) {
			return fail("not found")
		}
		return fail(err.Error())
	}
	if !info.IsDir() {
		return fail("path is not a directory")
	}

	if zipPath == "" {
		base := filepath.Base(srcAbs)
		if strings.TrimSpace(base) == "" || base == "." || base == string(filepath.Separator) {
			base = "folder"
		}
		zipPath = filepath.ToSlash(filepath.Join("_exports", fmt.Sprintf("%s-%d.zip", base, time.Now().Unix())))
	}
	zipAbs, err := e.deps.FS.Resolve(zipPath)
	if err != nil {
		return fail(err.Error())
	}
	if filepath.Clean(zipAbs) == filepath.Clean(e.deps.FS.Root()) {
		return fail("refuse to write zip to root")
	}
	if _, err := os.Stat(zipAbs); err == nil {
		return fail("destination exists")
	}
	if err := os.MkdirAll(filepath.Dir(zipAbs), 0o755); err != nil {
		return fail(err.Error())
	}

	files, err := backup.ZipDir(srcAbs, zipAbs)
	if err != nil {
		return fail(err.Error())
	}
	return ok(map[string]any{"path": path, "zip_path": zipPath, "files": files})
}

