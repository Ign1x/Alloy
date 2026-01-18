package commands

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

type copyStats struct {
	Files int
	Dirs  int
	Bytes int64
}

func (e *Executor) fsCopy(cmd protocol.Command) protocol.CommandResult {
	from, _ := asString(cmd.Args["from"])
	to, _ := asString(cmd.Args["to"])
	if strings.TrimSpace(from) == "" {
		return fail("from is required")
	}
	if strings.TrimSpace(to) == "" {
		return fail("to is required")
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	absFrom, err := e.deps.FS.Resolve(from)
	if err != nil {
		return fail(err.Error())
	}
	absTo, err := e.deps.FS.Resolve(to)
	if err != nil {
		return fail(err.Error())
	}

	if filepath.Clean(absFrom) == filepath.Clean(e.deps.FS.Root()) || filepath.Clean(absTo) == filepath.Clean(e.deps.FS.Root()) {
		return fail("refuse to copy root")
	}

	if _, err := os.Stat(absTo); err == nil {
		return fail("destination exists")
	} else if !errors.Is(err, os.ErrNotExist) {
		return fail(err.Error())
	}

	info, err := os.Lstat(absFrom)
	if err != nil {
		return fail(err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fail("refuse to copy symlink")
	}

	var stats copyStats
	if info.IsDir() {
		if hasPathPrefix(absTo, absFrom) && filepath.Clean(absTo) != filepath.Clean(absFrom) {
			return fail("refuse to copy directory into itself")
		}
		stats, err = copyDirNoOverwrite(absFrom, absTo)
	} else {
		if err := os.MkdirAll(filepath.Dir(absTo), 0o755); err != nil {
			return fail(err.Error())
		}
		mode := info.Mode().Perm()
		if mode == 0 {
			mode = 0o644
		}
		n, err2 := copyFileNoOverwrite(absFrom, absTo, mode)
		if err2 != nil {
			return fail(err2.Error())
		}
		stats = copyStats{Files: 1, Dirs: 0, Bytes: n}
	}
	if err != nil {
		return fail(err.Error())
	}

	return ok(map[string]any{
		"from":  from,
		"to":    to,
		"copied": true,
		"files": stats.Files,
		"dirs":  stats.Dirs,
		"bytes": stats.Bytes,
	})
}

func copyDirNoOverwrite(srcAbs, dstAbs string) (copyStats, error) {
	var stats copyStats
	if err := os.MkdirAll(dstAbs, 0o755); err != nil {
		return stats, err
	}
	stats.Dirs++

	entries, err := os.ReadDir(srcAbs)
	if err != nil {
		return stats, err
	}

	for _, ent := range entries {
		if ent.Type()&os.ModeSymlink != 0 {
			return stats, errors.New("refuse to copy symlink")
		}
		name := ent.Name()
		srcChild := filepath.Join(srcAbs, name)
		dstChild := filepath.Join(dstAbs, name)

		if ent.IsDir() {
			sub, err := copyDirNoOverwrite(srcChild, dstChild)
			if err != nil {
				return stats, err
			}
			stats.Files += sub.Files
			stats.Dirs += sub.Dirs
			stats.Bytes += sub.Bytes
			continue
		}

		info, err := ent.Info()
		if err != nil {
			return stats, err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return stats, errors.New("refuse to copy symlink")
		}
		mode := info.Mode().Perm()
		if mode == 0 {
			mode = 0o644
		}
		n, err := copyFileNoOverwrite(srcChild, dstChild, mode)
		if err != nil {
			return stats, err
		}
		stats.Files++
		stats.Bytes += n
	}

	return stats, nil
}

func copyFileNoOverwrite(srcAbs, dstAbs string, mode os.FileMode) (int64, error) {
	in, err := os.Open(srcAbs)
	if err != nil {
		return 0, err
	}
	defer in.Close()

	out, err := os.OpenFile(dstAbs, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return 0, err
	}
	defer func() {
		_ = out.Close()
	}()

	n, err := io.Copy(out, in)
	if err != nil {
		_ = out.Close()
		_ = os.Remove(dstAbs)
		return n, err
	}
	if err := out.Close(); err != nil {
		_ = os.Remove(dstAbs)
		return n, err
	}
	return n, nil
}

func hasPathPrefix(path, root string) bool {
	path = filepath.Clean(path)
	root = filepath.Clean(root)

	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
		root = strings.ToLower(root)
	}

	if path == root {
		return true
	}
	if !strings.HasSuffix(root, string(os.PathSeparator)) {
		root += string(os.PathSeparator)
	}
	return strings.HasPrefix(path, root)
}

