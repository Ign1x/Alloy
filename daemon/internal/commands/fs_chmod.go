package commands

import (
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

func parseChmodMode(v any) (os.FileMode, string, error) {
	var s string
	switch x := v.(type) {
	case string:
		s = x
	case float64:
		// JSON numbers decode as float64.
		s = strconv.FormatInt(int64(x), 10)
	case int:
		s = strconv.Itoa(x)
	case int64:
		s = strconv.FormatInt(x, 10)
	default:
		return 0, "", errors.New("mode is required")
	}
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(s, "0o")
	s = strings.TrimPrefix(s, "0O")
	if s == "" {
		return 0, "", errors.New("mode is required")
	}

	val, err := strconv.ParseUint(s, 8, 32)
	if err != nil {
		return 0, "", errors.New("mode must be octal digits (e.g. 644, 755)")
	}
	norm := strconv.FormatUint(val, 8)
	if len(norm) < 3 {
		norm = strings.Repeat("0", 3-len(norm)) + norm
	}
	return os.FileMode(val), norm, nil
}

func (e *Executor) fsChmod(cmd protocol.Command) protocol.CommandResult {
	path, _ := asString(cmd.Args["path"])
	path = strings.TrimSpace(path)
	if path == "" {
		return fail("path is required")
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	mode, modeStr, err := parseChmodMode(cmd.Args["mode"])
	if err != nil {
		return fail(err.Error())
	}
	// Safety: only allow a small, safe whitelist.
	if mode != 0o644 && mode != 0o755 {
		return fail("mode must be 644 or 755")
	}

	abs, err := e.deps.FS.Resolve(path)
	if err != nil {
		return fail(err.Error())
	}
	if filepath.Clean(abs) == filepath.Clean(e.deps.FS.Root()) {
		return fail("refuse to chmod root")
	}

	info, err := os.Lstat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return fail("not found")
		}
		return fail(err.Error())
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fail("refuse to chmod symlink")
	}
	if info.IsDir() && mode == 0o644 {
		return fail("refuse to chmod directory to 644")
	}

	if err := os.Chmod(abs, mode); err != nil {
		return fail(err.Error())
	}
	st, err := os.Stat(abs)
	if err != nil {
		return fail(err.Error())
	}

	return ok(map[string]any{
		"path":      path,
		"mode":      st.Mode().String(),
		"mode_bits": int64(st.Mode()),
		"chmod":     modeStr,
	})
}
