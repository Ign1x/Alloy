package commands

import (
	"fmt"
	"net"
	"strings"
	"time"

	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) netProbeTCP(cmd protocol.Command) protocol.CommandResult {
	host, _ := asString(cmd.Args["host"])
	host = strings.TrimSpace(host)
	if host == "" {
		return fail("host is required")
	}

	port, err := asInt(cmd.Args["port"])
	if err != nil {
		return fail("port must be int")
	}
	if port < 1 || port > 65535 {
		return fail("port invalid (1-65535)")
	}

	timeoutMs := 1200
	if raw, ok := cmd.Args["timeout_ms"]; ok {
		n, err := asInt(raw)
		if err != nil {
			return fail("timeout_ms must be int")
		}
		if n < 100 {
			n = 100
		}
		if n > 10_000 {
			n = 10_000
		}
		timeoutMs = n
	}

	addr := fmt.Sprintf("%s:%d", host, port)
	start := time.Now()
	conn, err := net.DialTimeout("tcp", addr, time.Duration(timeoutMs)*time.Millisecond)
	latencyMs := int(time.Since(start).Milliseconds())
	if err != nil {
		return ok(map[string]any{
			"host":       host,
			"port":       port,
			"online":     false,
			"latency_ms": latencyMs,
			"error":      err.Error(),
		})
	}
	_ = conn.Close()
	return ok(map[string]any{
		"host":       host,
		"port":       port,
		"online":     true,
		"latency_ms": latencyMs,
	})
}

