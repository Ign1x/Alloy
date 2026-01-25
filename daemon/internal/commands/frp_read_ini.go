package commands

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

var frpTokenLineRe = regexp.MustCompile(`(?mi)^\s*token\s*=\s*.*$`)

func (e *Executor) frpReadINI(cmd protocol.Command) protocol.CommandResult {
	if e.deps.FRP == nil {
		return fail("frp not configured")
	}

	name, _ := asString(cmd.Args["name"])
	if strings.TrimSpace(name) == "" {
		name, _ = asString(cmd.Args["instance_id"])
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return fail("name is required")
	}
	if err := validateInstanceID(name); err != nil {
		return fail(err.Error())
	}

	revealToken, _ := asBool(cmd.Args["reveal_token"])

	workDir := strings.TrimSpace(e.deps.FRP.WorkDir())
	if workDir == "" {
		return fail("frp workdir unavailable")
	}

	iniPath := filepath.Join(workDir, name, "frpc.ini")
	raw, err := os.ReadFile(iniPath)
	if err != nil {
		return fail(err.Error())
	}

	const maxBytes = 128 * 1024
	truncated := false
	if len(raw) > maxBytes {
		raw = raw[:maxBytes]
		truncated = true
	}

	ini := string(raw)
	if !revealToken {
		ini = frpTokenLineRe.ReplaceAllString(ini, "token = <redacted>")
	}

	return ok(map[string]any{
		"name":        name,
		"path":        filepath.ToSlash(filepath.Join(name, "frpc.ini")),
		"ini":         ini,
		"redacted":    !revealToken,
		"truncated":   truncated,
		"max_bytes":   maxBytes,
		"bytes_read":  len(raw),
		"has_manager": true,
	})
}
