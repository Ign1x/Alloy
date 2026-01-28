package commands

import (
	"bufio"
	"context"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"elegantmc/daemon/internal/protocol"
)

func (e *Executor) fsSearch(ctx context.Context, cmd protocol.Command) protocol.CommandResult {
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	baseRel, _ := asString(cmd.Args["path"])
	baseRel = strings.TrimSpace(baseRel)
	baseRel = strings.ReplaceAll(baseRel, "\\", "/")
	baseRel = strings.TrimPrefix(baseRel, "/")
	baseRel = strings.TrimSuffix(baseRel, "/")
	if baseRel == "." {
		baseRel = ""
	}

	absBase, err := e.deps.FS.Resolve(baseRel)
	if err != nil {
		return fail(err.Error())
	}
	info, err := os.Stat(absBase)
	if err != nil {
		if os.IsNotExist(err) {
			return fail("not found")
		}
		return fail(err.Error())
	}
	if !info.IsDir() {
		return fail("not a directory")
	}

	pattern, _ := asString(cmd.Args["pattern"])
	pattern = strings.TrimSpace(pattern)
	pattern = strings.ReplaceAll(pattern, "\\", "/")
	pattern = strings.TrimPrefix(pattern, "/")
	if pattern == "" {
		pattern = "**/*"
	}

	query, _ := asString(cmd.Args["query"])
	query = strings.TrimSpace(query)
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
	includeBinary := false
	if v, ok := asBool(cmd.Args["include_binary"]); ok {
		includeBinary = v
	}
	recursive := true
	if v, ok := asBool(cmd.Args["recursive"]); ok {
		recursive = v
	}

	maxFiles := 60
	if v, err := asInt(cmd.Args["max_files"]); err == nil {
		maxFiles = v
	}
	if maxFiles < 1 {
		maxFiles = 1
	}
	if maxFiles > 1000 {
		maxFiles = 1000
	}

	maxMatches := 200
	if v, err := asInt(cmd.Args["max_matches"]); err == nil {
		maxMatches = v
	}
	if maxMatches < 1 {
		maxMatches = 1
	}
	if maxMatches > 5000 {
		maxMatches = 5000
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
	if maxBytesTotal > 200*1024*1024 {
		maxBytesTotal = 200 * 1024 * 1024
	}

	// Compile content matcher.
	var re *regexp.Regexp
	qLower := ""
	if query != "" {
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
	}

	type fileReport struct {
		name            string
		path            string
		sizeBytes       int64
		mtimeUnix       int64
		matches         int
		skippedBinary   bool
		truncated       bool
		error           string
		traversalUnsafe bool
	}

	type match struct {
		path          string
		file          string
		lineNo        int
		text          string
		before        []string
		after         []string
		fileMtimeUnix int64
	}

	bytesTotal := int64(0)
	truncatedGlobal := false
	reports := make([]fileReport, 0, min(maxFiles, 256))
	matches := make([]match, 0, min(maxMatches, 256))

	// A hard cap to avoid walking pathological directories.
	const hardMaxEntries = 250_000
	entriesVisited := 0

	processFile := func(relFromBase string, d fs.DirEntry) {
		if len(reports) >= maxFiles {
			truncatedGlobal = true
			return
		}
		if len(matches) >= maxMatches || bytesTotal >= maxBytesTotal {
			truncatedGlobal = true
			return
		}

		name := strings.TrimSpace(d.Name())
		outPath := relFromBase
		if baseRel != "" {
			outPath = filepath.ToSlash(filepath.Join(baseRel, relFromBase))
		}

		rep := fileReport{name: name, path: outPath}
		if info, err := d.Info(); err == nil && info != nil {
			rep.sizeBytes = info.Size()
			rep.mtimeUnix = info.ModTime().Unix()
			if info.Size() > maxBytesPerFile {
				rep.truncated = true
			}
		}

		// Name-only search: only return the matching file list.
		if query == "" {
			reports = append(reports, rep)
			return
		}

		// Skip obvious binary types unless explicitly requested.
		if !includeBinary && likelyBinaryByExt(name) {
			rep.skippedBinary = true
			reports = append(reports, rep)
			return
		}

		absFile, err := e.deps.FS.Resolve(outPath)
		if err != nil {
			rep.traversalUnsafe = true
			rep.error = err.Error()
			reports = append(reports, rep)
			return
		}

		fh, err := os.Open(absFile)
		if err != nil {
			rep.error = err.Error()
			reports = append(reports, rep)
			return
		}
		defer fh.Close()

		// Lightweight binary detection: NULL byte in the header.
		if !includeBinary {
			buf := make([]byte, 512)
			n, rerr := fh.Read(buf)
			if rerr != nil && rerr != io.EOF {
				rep.error = rerr.Error()
				reports = append(reports, rep)
				return
			}
			if bytesIndexByte(buf[:n], 0) >= 0 {
				rep.skippedBinary = true
				reports = append(reports, rep)
				return
			}
			_, _ = fh.Seek(0, io.SeekStart)
		}

		reader := io.LimitReader(fh, maxBytesPerFile)
		sc := bufio.NewScanner(reader)
		// Default token limit is 64KiB which is too small for some configs/logs.
		sc.Buffer(make([]byte, 64*1024), 2*1024*1024)

		type afterTracker struct {
			idx    int
			remain int
		}
		trackers := make([]afterTracker, 0, 8)
		beforeBuf := make([]string, 0, ctxBefore)

		lineNo := 0
		fileMatches := 0
		for sc.Scan() {
			if ctx.Err() != nil {
				truncatedGlobal = true
				rep.truncated = true
				break
			}
			if len(matches) >= maxMatches || bytesTotal >= maxBytesTotal {
				truncatedGlobal = true
				rep.truncated = true
				break
			}
			line := sc.Text()
			bytesTotal += int64(len(line) + 1)
			lineNo++

			// Feed this line into active after-context trackers.
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
					path:          outPath,
					file:          name,
					lineNo:        lineNo,
					text:          line,
					before:        append([]string(nil), beforeBuf...),
					after:         []string{},
					fileMtimeUnix: rep.mtimeUnix,
				}
				matches = append(matches, rec)
				fileMatches++
				if ctxAfter > 0 {
					trackers = append(trackers, afterTracker{idx: len(matches) - 1, remain: ctxAfter})
				}
			}

			if ctxBefore > 0 {
				beforeBuf = append(beforeBuf, line)
				if len(beforeBuf) > ctxBefore {
					beforeBuf = beforeBuf[len(beforeBuf)-ctxBefore:]
				}
			}
		}
		if err := sc.Err(); err != nil {
			rep.truncated = true
			if rep.error == "" {
				rep.error = err.Error()
			}
		}
		rep.matches = fileMatches
		reports = append(reports, rep)
	}

	walkDir := func() error {
		return filepath.WalkDir(absBase, func(abs string, d fs.DirEntry, err error) error {
			entriesVisited++
			if entriesVisited > hardMaxEntries {
				truncatedGlobal = true
				return filepath.SkipAll
			}
			if err != nil {
				return nil
			}
			if ctx.Err() != nil {
				truncatedGlobal = true
				return filepath.SkipAll
			}
			if d == nil {
				return nil
			}

			// Avoid symlink traversal.
			if d.Type()&os.ModeSymlink != 0 {
				if d.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if d.IsDir() {
				return nil
			}
			if !d.Type().IsRegular() {
				return nil
			}

			rel, err := filepath.Rel(absBase, abs)
			if err != nil {
				return nil
			}
			rel = filepath.ToSlash(rel)
			if rel == "." || rel == "" {
				return nil
			}

			if !matchGlob(pattern, rel) {
				return nil
			}
			if len(reports) >= maxFiles {
				truncatedGlobal = true
				return filepath.SkipAll
			}
			processFile(rel, d)
			if len(reports) >= maxFiles || len(matches) >= maxMatches || bytesTotal >= maxBytesTotal {
				truncatedGlobal = true
				return filepath.SkipAll
			}
			return nil
		})
	}

	listDir := func() error {
		ents, err := os.ReadDir(absBase)
		if err != nil {
			return err
		}
		for _, ent := range ents {
			entriesVisited++
			if entriesVisited > hardMaxEntries {
				truncatedGlobal = true
				break
			}
			if ctx.Err() != nil {
				truncatedGlobal = true
				break
			}
			if ent == nil {
				continue
			}
			if ent.Type()&os.ModeSymlink != 0 {
				continue
			}
			if ent.IsDir() || !ent.Type().IsRegular() {
				continue
			}
			name := strings.TrimSpace(ent.Name())
			if name == "" {
				continue
			}
			if !matchGlob(pattern, name) {
				continue
			}
			processFile(filepath.ToSlash(name), dirEntryAdapter{ent: ent, absDir: absBase})
			if len(reports) >= maxFiles || len(matches) >= maxMatches || bytesTotal >= maxBytesTotal {
				truncatedGlobal = true
				break
			}
		}
		return nil
	}

	if recursive {
		_ = walkDir()
	} else {
		if err := listDir(); err != nil {
			return fail(err.Error())
		}
	}

	outFiles := make([]map[string]any, 0, len(reports))
	for _, r := range reports {
		outFiles = append(outFiles, map[string]any{
			"name":           r.name,
			"path":           r.path,
			"size_bytes":     r.sizeBytes,
			"mtime_unix":     r.mtimeUnix,
			"matches":        r.matches,
			"skipped_binary": r.skippedBinary,
			"truncated":      r.truncated,
			"error":          r.error,
		})
	}

	outMatches := make([]map[string]any, 0, len(matches))
	for _, m := range matches {
		outMatches = append(outMatches, map[string]any{
			"path":            m.path,
			"file":            m.file,
			"line_no":         m.lineNo,
			"text":            m.text,
			"before":          m.before,
			"after":           m.after,
			"file_mtime_unix": m.fileMtimeUnix,
		})
	}

	return ok(map[string]any{
		"path":                 baseRel,
		"pattern":              pattern,
		"query":                query,
		"regex":                regex,
		"case_sensitive":       caseSensitive,
		"recursive":            recursive,
		"include_binary":       includeBinary,
		"max_files":            maxFiles,
		"max_matches":          maxMatches,
		"context_before":       ctxBefore,
		"context_after":        ctxAfter,
		"max_bytes_per_file":   maxBytesPerFile,
		"max_bytes_total":      maxBytesTotal,
		"bytes_scanned":        bytesTotal,
		"entries_visited":      entriesVisited,
		"truncated":            truncatedGlobal,
		"files":                outFiles,
		"matches":              outMatches,
		"server_time_unix":     time.Now().Unix(),
		"hard_max_entries":     hardMaxEntries,
		"pattern_support_note": "supports * ? [] and ** (globstar)",
	})
}

// matchGlob matches a slash-separated relative path against a glob.
// If the glob has no '/', it is treated as a basename match.
func matchGlob(glob string, rel string) bool {
	glob = strings.TrimSpace(glob)
	glob = strings.ReplaceAll(glob, "\\", "/")
	glob = strings.TrimPrefix(glob, "./")
	glob = strings.TrimPrefix(glob, "/")
	if glob == "" {
		glob = "**/*"
	}

	rel = strings.ReplaceAll(rel, "\\", "/")
	rel = strings.TrimPrefix(rel, "./")
	rel = strings.TrimPrefix(rel, "/")
	if rel == "" {
		return false
	}

	if !strings.Contains(glob, "/") {
		base := path.Base(rel)
		ok, err := path.Match(glob, base)
		return err == nil && ok
	}

	patSegs := strings.Split(glob, "/")
	pathSegs := strings.Split(rel, "/")
	return matchGlobSegs(patSegs, pathSegs)
}

func matchGlobSegs(pat []string, segs []string) bool {
	if len(pat) == 0 {
		return len(segs) == 0
	}
	if pat[0] == "**" {
		// Collapse consecutive **
		for len(pat) > 0 && pat[0] == "**" {
			pat = pat[1:]
		}
		if len(pat) == 0 {
			return true
		}
		for i := 0; i <= len(segs); i++ {
			if matchGlobSegs(pat, segs[i:]) {
				return true
			}
		}
		return false
	}
	if len(segs) == 0 {
		return false
	}
	ok, err := path.Match(pat[0], segs[0])
	if err != nil || !ok {
		return false
	}
	return matchGlobSegs(pat[1:], segs[1:])
}

func likelyBinaryByExt(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	return strings.HasSuffix(lower, ".jar") ||
		strings.HasSuffix(lower, ".zip") ||
		strings.HasSuffix(lower, ".png") ||
		strings.HasSuffix(lower, ".jpg") ||
		strings.HasSuffix(lower, ".jpeg") ||
		strings.HasSuffix(lower, ".gif") ||
		strings.HasSuffix(lower, ".webp") ||
		strings.HasSuffix(lower, ".ico") ||
		strings.HasSuffix(lower, ".pdf") ||
		strings.HasSuffix(lower, ".mp3") ||
		strings.HasSuffix(lower, ".mp4") ||
		strings.HasSuffix(lower, ".mkv") ||
		strings.HasSuffix(lower, ".wav") ||
		strings.HasSuffix(lower, ".ogg") ||
		strings.HasSuffix(lower, ".class") ||
		strings.HasSuffix(lower, ".dll") ||
		strings.HasSuffix(lower, ".exe") ||
		strings.HasSuffix(lower, ".so") ||
		strings.HasSuffix(lower, ".dat") ||
		strings.HasSuffix(lower, ".nbt")
}

func bytesIndexByte(b []byte, c byte) int {
	for i := 0; i < len(b); i++ {
		if b[i] == c {
			return i
		}
	}
	return -1
}

// dirEntryAdapter adapts an os.DirEntry to an io/fs.DirEntry with stable Info().
// This is used for non-recursive listing.
type dirEntryAdapter struct {
	ent    os.DirEntry
	absDir string
}

func (d dirEntryAdapter) Name() string { return d.ent.Name() }
func (d dirEntryAdapter) IsDir() bool  { return d.ent.IsDir() }
func (d dirEntryAdapter) Type() fs.FileMode {
	return d.ent.Type()
}
func (d dirEntryAdapter) Info() (fs.FileInfo, error) {
	if d.absDir == "" {
		return d.ent.Info()
	}
	// Ensure Info reads from the filesystem path to populate size/mtime.
	return os.Stat(filepath.Join(d.absDir, d.ent.Name()))
}
