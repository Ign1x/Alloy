package commands

import (
	"os"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) fsStat(cmd protocol.Command) protocol.CommandResult {
	path, _ := asString(cmd.Args["path"])
	if strings.TrimSpace(path) == "" {
		return fail("path is required")
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	abs, err := e.deps.FS.Resolve(path)
	if err != nil {
		return fail(err.Error())
	}
	info, err := os.Stat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return fail("not found")
		}
		return fail(err.Error())
	}

	return ok(map[string]any{
		"path":       path,
		"isDir":      info.IsDir(),
		"size":       info.Size(),
		"mtime_unix": info.ModTime().Unix(),
		"mode":       info.Mode().String(),
		"mode_bits":  int64(info.Mode()),
	})
}

