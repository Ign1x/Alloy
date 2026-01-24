package commands

import (
	"archive/zip"
	"context"
	"os"
	"path"
	"sort"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

type zipListEntry struct {
	Path  string `json:"path"`
	IsDir bool   `json:"is_dir"`
	Bytes uint64 `json:"bytes"`
}

func (e *Executor) fsZipList(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	zipPath, _ := asString(cmd.Args["zip_path"])
	zipPath = strings.TrimSpace(zipPath)

	stripTop := true
	if v, ok := asBool(cmd.Args["strip_top_level"]); ok {
		stripTop = v
	}

	if zipPath == "" {
		return fail("zip_path is required")
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	zipAbs, err := e.deps.FS.Resolve(zipPath)
	if err != nil {
		return fail(err.Error())
	}

	zr, err := zip.OpenReader(zipAbs)
	if err != nil {
		return fail(err.Error())
	}
	defer zr.Close()

	top := make(map[string]struct{})
	for _, f := range zr.File {
		select {
		case <-ctx.Done():
			return fail(ctx.Err().Error())
		default:
		}

		if f == nil {
			continue
		}
		name := strings.ReplaceAll(f.Name, "\\", "/")
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}
		if strings.HasPrefix(name, "__MACOSX/") {
			continue
		}

		parts := strings.Split(name, "/")
		if len(parts) == 0 || parts[0] == "" {
			continue
		}
		top[parts[0]] = struct{}{}
		if len(top) > 1 {
			break
		}
	}

	topLevelDir := ""
	if len(top) == 1 {
		for k := range top {
			topLevelDir = k
		}
	}

	stripPrefix := ""
	if stripTop && topLevelDir != "" {
		stripPrefix = topLevelDir + "/"
	}

	var files int
	var totalBytes uint64
	entries := make([]zipListEntry, 0, len(zr.File))

	for _, f := range zr.File {
		select {
		case <-ctx.Done():
			return fail(ctx.Err().Error())
		default:
		}

		if f == nil {
			continue
		}
		if f.FileInfo().Mode()&os.ModeSymlink != 0 {
			return fail("zip contains symlink (refuse)")
		}

		name := strings.ReplaceAll(f.Name, "\\", "/")
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}
		if strings.HasPrefix(name, "__MACOSX/") {
			continue
		}
		if stripPrefix != "" && strings.HasPrefix(name, stripPrefix) {
			name = strings.TrimPrefix(name, stripPrefix)
		}
		name = strings.TrimPrefix(name, "/")
		if name == "" {
			continue
		}

		isDir := f.FileInfo().IsDir() || strings.HasSuffix(name, "/") || strings.HasSuffix(f.Name, "/")

		clean := path.Clean(name)
		if clean == "." || clean == "/" {
			continue
		}
		if strings.HasPrefix(clean, "../") || clean == ".." || strings.HasPrefix(clean, "/") {
			return fail("zip entry escapes destination")
		}

		var bytes uint64
		if !isDir {
			bytes = f.UncompressedSize64
			totalBytes += bytes
			files++
		}
		entries = append(entries, zipListEntry{Path: clean, IsDir: isDir, Bytes: bytes})
	}

	sort.Slice(entries, func(i, j int) bool {
		return entries[i].Path < entries[j].Path
	})

	return ok(map[string]any{
		"zip_path":       zipPath,
		"strip_top":      stripTop,
		"top_level_dir":  topLevelDir,
		"strip_prefix":   stripPrefix,
		"files":          files,
		"total_bytes":    totalBytes,
		"entries":        entries,
		"entries_count":  len(entries),
	})
}
