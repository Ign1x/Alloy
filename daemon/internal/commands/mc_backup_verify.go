package commands

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"elegantmc/daemon/internal/protocol"
)

const maxBackupVerifyAnomalies = 20

func copyDiscardWithContext(ctx context.Context, r io.Reader) (int64, error) {
	buf := make([]byte, 32*1024)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := r.Read(buf)
		if n > 0 {
			total += int64(n)
		}
		if err == io.EOF {
			return total, nil
		}
		if err != nil {
			return total, err
		}
	}
}

func (e *Executor) mcBackupVerify(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	zipRel, _ := asString(cmd.Args["zip_path"])
	zipRel = strings.TrimSpace(zipRel)
	if zipRel == "" {
		return fail("zip_path is required")
	}
	zipAbs, err := e.deps.FS.Resolve(zipRel)
	if err != nil {
		return fail(err.Error())
	}
	st, err := os.Stat(zipAbs)
	if err != nil {
		return fail(err.Error())
	}
	if st.IsDir() {
		return fail("zip_path must be a file")
	}

	started := time.Now()
	lower := strings.ToLower(zipRel)
	format := "zip"
	if strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz") {
		format = "tar.gz"
	}

	var entries int
	var bytes int64
	anomalies := make([]map[string]any, 0)

	if format == "zip" {
		zr, err := zip.OpenReader(zipAbs)
		if err != nil {
			return ok(map[string]any{
				"zip_path":           zipRel,
				"format":             format,
				"valid":              false,
				"archive_size_bytes": st.Size(),
				"entries":            0,
				"bytes":              0,
				"anomalies": []map[string]any{
					{"path": "<archive>", "error": err.Error()},
				},
			})
		}
		defer zr.Close()

		for _, f := range zr.File {
			if f == nil {
				continue
			}
			entries++
			name := f.Name
			if f.FileInfo().IsDir() {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				anomalies = append(anomalies, map[string]any{"path": name, "error": err.Error()})
				if len(anomalies) >= maxBackupVerifyAnomalies {
					break
				}
				continue
			}
			n, readErr := copyDiscardWithContext(ctx, rc)
			closeErr := rc.Close()
			bytes += n
			if readErr != nil {
				anomalies = append(anomalies, map[string]any{"path": name, "error": readErr.Error()})
			}
			if closeErr != nil {
				anomalies = append(anomalies, map[string]any{"path": name, "error": closeErr.Error()})
			}
			if len(anomalies) >= maxBackupVerifyAnomalies {
				break
			}
		}
	} else {
		f, err := os.Open(zipAbs)
		if err != nil {
			return fail(err.Error())
		}
		defer f.Close()

		gz, err := gzip.NewReader(f)
		if err != nil {
			return ok(map[string]any{
				"zip_path":           zipRel,
				"format":             format,
				"valid":              false,
				"archive_size_bytes": st.Size(),
				"entries":            0,
				"bytes":              0,
				"anomalies": []map[string]any{
					{"path": "<archive>", "error": err.Error()},
				},
			})
		}
		defer gz.Close()

		tr := tar.NewReader(gz)
		for {
			if err := ctx.Err(); err != nil {
				return fail(err.Error())
			}
			h, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				anomalies = append(anomalies, map[string]any{"path": "<tar>", "error": err.Error()})
				break
			}
			if h == nil {
				continue
			}
			entries++
			// Only read regular files; other types still advance the stream.
			switch h.Typeflag {
			case tar.TypeReg, tar.TypeRegA:
				n, err := copyDiscardWithContext(ctx, tr)
				bytes += n
				if err != nil {
					anomalies = append(anomalies, map[string]any{"path": h.Name, "error": err.Error()})
					// tar stream can't reliably continue after a read error.
					goto doneTar
				}
			}
			if len(anomalies) >= maxBackupVerifyAnomalies {
				break
			}
		}
	}

doneTar:
	durMs := time.Since(started).Milliseconds()
	valid := len(anomalies) == 0
	return ok(map[string]any{
		"zip_path":           zipRel,
		"format":             format,
		"valid":              valid,
		"archive_size_bytes": st.Size(),
		"entries":            entries,
		"bytes":              bytes,
		"duration_ms":         durMs,
		"anomalies":          anomalies,
		"note":               fmt.Sprintf("best-effort verify (max anomalies=%d)", maxBackupVerifyAnomalies),
	})
}
