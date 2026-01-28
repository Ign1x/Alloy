package commands

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"elegantmc/daemon/internal/backup"
	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) fsZip(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	path, _ := asString(cmd.Args["path"])
	zipPath, _ := asString(cmd.Args["zip_path"])
	baseDir, _ := asString(cmd.Args["base_dir"])
	paths, _ := asStringSlice(cmd.Args["paths"])
	path = strings.TrimSpace(path)
	zipPath = strings.TrimSpace(zipPath)
	baseDir = strings.TrimSpace(baseDir)

	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	// Multi-path zip (selection mode).
	if len(paths) > 0 {
		return e.fsZipPaths(ctx, paths, baseDir, zipPath)
	}

	if path == "" {
		return fail("path is required")
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

func (e *Executor) fsZipPaths(ctx context.Context, paths []string, baseDir string, zipPath string) protocol.CommandResult {
	_ = ctx

	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	cleanPaths := make([]string, 0, len(paths))
	for _, p := range paths {
		s := strings.TrimSpace(p)
		if s == "" || s == "." || s == ".." {
			continue
		}
		cleanPaths = append(cleanPaths, s)
	}
	if len(cleanPaths) == 0 {
		return fail("paths is required")
	}
	sort.Strings(cleanPaths)

	baseDir = strings.TrimSpace(baseDir)
	if baseDir == "" {
		baseDir = "."
	}
	baseAbs, err := e.deps.FS.Resolve(baseDir)
	if err != nil {
		return fail(err.Error())
	}
	if filepath.Clean(baseAbs) == filepath.Clean(e.deps.FS.Root()) {
		// Allow selecting items under root, but don't allow zipping the root itself.
		for _, p := range cleanPaths {
			if filepath.Clean(filepath.FromSlash(p)) == "." {
				return fail("refuse to zip root")
			}
		}
	}

	if zipPath == "" {
		base := "selection"
		if len(cleanPaths) == 1 {
			base = filepath.Base(filepath.FromSlash(cleanPaths[0]))
		}
		base = strings.TrimSpace(base)
		if base == "" || base == "." || base == string(filepath.Separator) {
			base = "selection"
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

	files, err := backup.ZipPaths(baseAbs, cleanPaths, zipAbs)
	if err != nil {
		return fail(err.Error())
	}
	return ok(map[string]any{"base_dir": baseDir, "paths": cleanPaths, "zip_path": zipPath, "files": files})
}
