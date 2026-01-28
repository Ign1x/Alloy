package commands

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"os"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) fsHash(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	path, _ := asString(cmd.Args["path"])
	if strings.TrimSpace(path) == "" {
		return fail("path is required")
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	maxBytes := int64(512 * 1024 * 1024) // 512 MiB default safety cap
	if v, err := asInt(cmd.Args["max_bytes"]); err == nil && v > 0 {
		maxBytes = int64(v)
	}
	const hardMaxBytes = int64(2 * 1024 * 1024 * 1024) // 2 GiB hard cap
	if maxBytes > hardMaxBytes {
		return fail("max_bytes too large")
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
	if info.IsDir() {
		return fail("not a file")
	}
	if info.Size() > maxBytes {
		return fail("file too large")
	}

	f, err := os.Open(abs)
	if err != nil {
		return fail(err.Error())
	}
	defer f.Close()

	h := sha256.New()
	buf := make([]byte, 256*1024)
	var readBytes int64
	for {
		if ctx.Err() != nil {
			return fail(ctx.Err().Error())
		}
		n, rerr := f.Read(buf)
		if n > 0 {
			readBytes += int64(n)
			if readBytes > maxBytes {
				return fail("file too large")
			}
			_, _ = h.Write(buf[:n])
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			return fail(rerr.Error())
		}
	}

	return ok(map[string]any{
		"path":      path,
		"bytes":     readBytes,
		"sha256":    hex.EncodeToString(h.Sum(nil)),
		"max_bytes": maxBytes,
	})
}
