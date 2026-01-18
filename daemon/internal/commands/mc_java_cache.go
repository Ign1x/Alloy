package commands

import (
	"os"
	"path/filepath"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) mcJavaCacheList(cmd protocol.Command) protocol.CommandResult {
	_ = cmd
	if e.deps.MC == nil {
		return ok(map[string]any{"cache_dir": "", "runtimes": []any{}})
	}
	rt := e.deps.MC.JavaRuntimeManager()
	if rt == nil {
		return ok(map[string]any{"cache_dir": "", "runtimes": []any{}})
	}
	list, err := rt.ListCached()
	if err != nil {
		return fail(err.Error())
	}
	return ok(map[string]any{
		"cache_dir": rt.CacheDir(),
		"runtimes":  list,
		"count":     len(list),
	})
}

func (e *Executor) mcJavaCacheRemove(cmd protocol.Command) protocol.CommandResult {
	key, _ := asString(cmd.Args["key"])
	key = strings.TrimSpace(key)
	if key == "" {
		return fail("key is required")
	}
	if strings.ContainsAny(key, `/\\`) {
		return fail("invalid key")
	}
	if e.deps.MC == nil {
		return fail("mc manager not configured")
	}
	rt := e.deps.MC.JavaRuntimeManager()
	if rt == nil {
		return fail("java cache not enabled")
	}
	cacheDir := strings.TrimSpace(rt.CacheDir())
	if cacheDir == "" {
		return fail("java cache dir not configured")
	}

	abs := filepath.Clean(filepath.Join(cacheDir, key))
	if filepath.Clean(abs) == filepath.Clean(cacheDir) || !hasPathPrefix(abs, cacheDir) {
		return fail("invalid key")
	}
	if err := os.RemoveAll(abs); err != nil {
		return fail(err.Error())
	}
	return ok(map[string]any{"removed": true, "key": key})
}

