package commands

import (
	"bufio"
	"compress/gzip"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"elegantmc/daemon/internal/protocol"
)

type logSearchFile struct {
	name      string
	relPath   string
	absPath   string
	sizeBytes int64
	mtimeUnix int64
	isGzip    bool
}

func (e *Executor) mcLogSearch(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	instanceID, _ := asString(cmd.Args["instance_id"])
	instanceID = strings.TrimSpace(instanceID)
	if instanceID == "" {
		return fail("instance_id is required")
	}
	if err := validateInstanceID(instanceID); err != nil {
		return fail(err.Error())
	}

	query, _ := asString(cmd.Args["query"])
	query = strings.TrimSpace(query)
	if query == "" {
		return fail("query is required")
	}
	if len(query) > 200 {
		return fail("query too long")
	}

	regex := false
	if v, ok := asBool(cmd.Args["regex"]); ok {
		regex = v
	}
	caseSensitive := false
	if v, ok := asBool(cmd.Args["case_sensitive"]); ok {
		caseSensitive = v
	}

	maxFiles := 10
	if v, err := asInt(cmd.Args["max_files"]); err == nil {
		maxFiles = v
	}
	if maxFiles < 1 {
		maxFiles = 1
	}
	if maxFiles > 60 {
		maxFiles = 60
	}

	maxMatches := 200
	if v, err := asInt(cmd.Args["max_matches"]); err == nil {
		maxMatches = v
	}
	if maxMatches < 1 {
		maxMatches = 1
	}
	if maxMatches > 2000 {
		maxMatches = 2000
	}

	ctxBefore := 0
	if v, err := asInt(cmd.Args["context_before"]); err == nil {
		ctxBefore = v
	}
	if ctxBefore < 0 {
		ctxBefore = 0
	}
	if ctxBefore > 20 {
		ctxBefore = 20
	}
	ctxAfter := 0
	if v, err := asInt(cmd.Args["context_after"]); err == nil {
		ctxAfter = v
	}
	if ctxAfter < 0 {
		ctxAfter = 0
	}
	if ctxAfter > 20 {
		ctxAfter = 20
	}

	maxBytesPerFile := int64(2 * 1024 * 1024)
	if v, err := asInt(cmd.Args["max_bytes_per_file"]); err == nil {
		maxBytesPerFile = int64(v)
	}
	if maxBytesPerFile < 64*1024 {
		maxBytesPerFile = 64 * 1024
	}
	if maxBytesPerFile > 20*1024*1024 {
		maxBytesPerFile = 20 * 1024 * 1024
	}

	maxBytesTotal := int64(8 * 1024 * 1024)
	if v, err := asInt(cmd.Args["max_bytes_total"]); err == nil {
		maxBytesTotal = int64(v)
	}
	if maxBytesTotal < 256*1024 {
		maxBytesTotal = 256 * 1024
	}
	if maxBytesTotal > 100*1024*1024 {
		maxBytesTotal = 100 * 1024 * 1024
	}

	includeGz := true
	if v, ok := asBool(cmd.Args["include_gz"]); ok {
		includeGz = v
	}

	logsRel := filepath.ToSlash(filepath.Join(instanceID, "logs"))
	logsAbs, err := e.deps.FS.Resolve(logsRel)
	if err != nil {
		return fail(err.Error())
	}

	ents, err := os.ReadDir(logsAbs)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ok(map[string]any{
				"instance_id": instanceID,
				"query":       query,
				"regex":       regex,
				"matches":     []any{},
				"files":       []any{},
				"note":        "logs folder not found",
			})
		}
		return fail(err.Error())
	}

	files := make([]logSearchFile, 0, len(ents))
	for _, ent := range ents {
		if ent == nil || ent.IsDir() {
			continue
		}
		name := strings.TrimSpace(ent.Name())
		if name == "" {
			continue
		}
		lower := strings.ToLower(name)
		isGz := strings.HasSuffix(lower, ".gz")
		if isGz && !includeGz {
			continue
		}
		if !strings.HasSuffix(lower, ".log") && !strings.HasSuffix(lower, ".log.gz") && !strings.HasSuffix(lower, ".gz") {
			continue
		}
		info, err := ent.Info()
		if err != nil || info == nil {
			continue
		}
		files = append(files, logSearchFile{
			name:      name,
			relPath:   filepath.ToSlash(filepath.Join(instanceID, "logs", name)),
			absPath:   filepath.Join(logsAbs, name),
			sizeBytes: info.Size(),
			mtimeUnix: info.ModTime().Unix(),
			isGzip:    isGz,
		})
	}

	sort.Slice(files, func(i, j int) bool {
		if files[i].mtimeUnix == files[j].mtimeUnix {
			return files[i].name > files[j].name
		}
		return files[i].mtimeUnix > files[j].mtimeUnix
	})

	type fileReport struct {
		name             string
		path             string
		sizeBytes        int64
		mtimeUnix        int64
		isGzip           bool
		truncatedPrefix  bool
		truncatedContent bool
		matches          int
	}

	type match struct {
		path          string
		file          string
		lineNo        int
		lineNoApprox  bool
		text          string
		before        []string
		after         []string
		fileMtimeUnix int64
	}

	var re *regexp.Regexp
	qLower := ""
	if regex {
		pat := query
		if !caseSensitive {
			pat = "(?i)" + pat
		}
		compiled, err := regexp.Compile(pat)
		if err != nil {
			return fail("regex compile failed: " + err.Error())
		}
		re = compiled
	} else if !caseSensitive {
		qLower = strings.ToLower(query)
	}

	matches := make([]match, 0, min(maxMatches, 256))
	reports := make([]fileReport, 0, min(maxFiles, len(files)))

	bytesTotal := int64(0)
	truncatedGlobal := false

	for _, f := range files {
		if len(reports) >= maxFiles || len(matches) >= maxMatches || bytesTotal >= maxBytesTotal {
			truncatedGlobal = true
			break
		}
		select {
		case <-ctx.Done():
			return fail(ctx.Err().Error())
		default:
		}

		rep := fileReport{
			name:      f.name,
			path:      f.relPath,
			sizeBytes: f.sizeBytes,
			mtimeUnix: f.mtimeUnix,
			isGzip:    f.isGzip,
		}

		fileMatches := 0
		lineNo := 0
		lineNoApprox := false

		var openErr error
		var reader io.Reader
		var closer io.Closer

		if f.isGzip {
			fh, err := os.Open(f.absPath)
			if err != nil {
				openErr = err
			} else {
				gz, err := gzip.NewReader(fh)
				if err != nil {
					_ = fh.Close()
					openErr = err
				} else {
					closer = multiCloser{closers: []io.Closer{gz, fh}}
					reader = io.LimitReader(gz, maxBytesPerFile)
					if f.sizeBytes > maxBytesPerFile {
						rep.truncatedContent = true
					}
				}
			}
		} else {
			fh, err := os.Open(f.absPath)
			if err != nil {
				openErr = err
			} else {
				closer = fh
				start := int64(0)
				if f.sizeBytes > maxBytesPerFile {
					start = f.sizeBytes - maxBytesPerFile
					rep.truncatedPrefix = true
					lineNoApprox = true
				}
				if start > 0 {
					if _, err := fh.Seek(start, io.SeekStart); err != nil {
						_ = fh.Close()
						openErr = err
					} else {
						reader = fh
					}
				} else {
					reader = fh
				}
			}
		}

		if openErr != nil {
			// Record the file but skip it.
			reports = append(reports, rep)
			continue
		}
		func() {
			defer func() {
				if closer != nil {
					_ = closer.Close()
				}
			}()

			sc := bufio.NewScanner(reader)
			buf := make([]byte, 64*1024)
			sc.Buffer(buf, 2*1024*1024)

			type afterTracker struct {
				idx   int
				remain int
			}
			trackers := make([]afterTracker, 0, 8)
			beforeBuf := make([]string, 0, ctxBefore)

			for sc.Scan() {
				select {
				case <-ctx.Done():
					truncatedGlobal = true
					rep.truncatedContent = true
					return
				default:
				}
				if len(matches) >= maxMatches || bytesTotal >= maxBytesTotal {
					truncatedGlobal = true
					rep.truncatedContent = true
					return
				}
				line := sc.Text()
				// rough accounting (scanner strips newline)
				bytesTotal += int64(len(line) + 1)
				lineNo++

				// Feed this line into any active after-context trackers.
				if len(trackers) > 0 {
					next := trackers[:0]
					for _, tr := range trackers {
						if tr.remain <= 0 {
							continue
						}
						matches[tr.idx].after = append(matches[tr.idx].after, line)
						tr.remain--
						if tr.remain > 0 {
							next = append(next, tr)
						}
					}
					trackers = next
				}

				okMatch := false
				if re != nil {
					okMatch = re.MatchString(line)
				} else if caseSensitive {
					okMatch = strings.Contains(line, query)
				} else {
					okMatch = strings.Contains(strings.ToLower(line), qLower)
				}

				if okMatch {
					rec := match{
						path:          f.relPath,
						file:          f.name,
						lineNo:        lineNo,
						lineNoApprox:  lineNoApprox || rep.truncatedPrefix,
						text:          line,
						before:        append([]string(nil), beforeBuf...),
						after:         []string{},
						fileMtimeUnix: f.mtimeUnix,
					}
					matches = append(matches, rec)
					fileMatches++
					if ctxAfter > 0 {
						trackers = append(trackers, afterTracker{idx: len(matches) - 1, remain: ctxAfter})
					}
					if len(matches) >= maxMatches {
						truncatedGlobal = true
						rep.truncatedContent = true
						return
					}
				}

				// Update before-context ring buffer.
				if ctxBefore > 0 {
					beforeBuf = append(beforeBuf, line)
					if len(beforeBuf) > ctxBefore {
						beforeBuf = beforeBuf[len(beforeBuf)-ctxBefore:]
					}
				}
			}
			if err := sc.Err(); err != nil {
				rep.truncatedContent = true
			}
		}()

		rep.matches = fileMatches
		reports = append(reports, rep)
	}

	outMatches := make([]map[string]any, 0, len(matches))
	for _, m := range matches {
		outMatches = append(outMatches, map[string]any{
			"path":            m.path,
			"file":            m.file,
			"line_no":         m.lineNo,
			"line_no_approx":  m.lineNoApprox,
			"text":            m.text,
			"before":          m.before,
			"after":           m.after,
			"file_mtime_unix": m.fileMtimeUnix,
		})
	}

	outFiles := make([]map[string]any, 0, len(reports))
	for _, r := range reports {
		outFiles = append(outFiles, map[string]any{
			"name":              r.name,
			"path":              r.path,
			"size_bytes":        r.sizeBytes,
			"mtime_unix":        r.mtimeUnix,
			"is_gzip":           r.isGzip,
			"matches":           r.matches,
			"truncated_prefix":  r.truncatedPrefix,
			"truncated_content": r.truncatedContent,
		})
	}

	return ok(map[string]any{
		"instance_id": instanceID,
		"query":       query,
		"regex":       regex,
		"case_sensitive": caseSensitive,
		"include_gz":     includeGz,
		"max_files":      maxFiles,
		"max_matches":    maxMatches,
		"context_before": ctxBefore,
		"context_after":  ctxAfter,
		"max_bytes_per_file": maxBytesPerFile,
		"max_bytes_total":    maxBytesTotal,
		"bytes_scanned":      bytesTotal,
		"truncated":          truncatedGlobal,
		"files":              outFiles,
		"matches":            outMatches,
		"server_time_unix":   time.Now().Unix(),
	})
}

type multiCloser struct {
	closers []io.Closer
}

func (m multiCloser) Close() error {
	var firstErr error
	for _, c := range m.closers {
		if c == nil {
			continue
		}
		if err := c.Close(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

