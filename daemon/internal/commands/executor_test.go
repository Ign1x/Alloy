package commands

import (
	"archive/zip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"elegantmc/daemon/internal/frp"
	"elegantmc/daemon/internal/mc"
	"elegantmc/daemon/internal/protocol"
	"elegantmc/daemon/internal/sandbox"
)

func newTestExecutor(t *testing.T) (*Executor, *sandbox.FS, string) {
	t.Helper()

	base := t.TempDir()
	serversRoot := filepath.Join(base, "servers")
	if err := os.MkdirAll(serversRoot, 0o755); err != nil {
		t.Fatalf("mkdir servers: %v", err)
	}
	fs, err := sandbox.NewFS(serversRoot)
	if err != nil {
		t.Fatalf("sandbox.NewFS: %v", err)
	}

	frpMgr := frp.NewManager(frp.ManagerConfig{
		FRPCPath: "/bin/true",
		WorkDir:  filepath.Join(base, "frp"),
		Log:      nil,
	})
	mcMgr := mc.NewManager(mc.ManagerConfig{
		ServersFS:        fs,
		Log:              nil,
		JavaCandidates:   []string{"java"},
		JavaAutoDownload: false,
	})

	ex := NewExecutor(ExecutorDeps{
		FS:   fs,
		FRP:  frpMgr,
		MC:   mcMgr,
		FRPC: filepath.Join(base, "bin", "frpc"),
		Mojang: MojangConfig{
			MetaBaseURL: "https://example.invalid",
			DataBaseURL: "https://example.invalid",
		},
		Paper: PaperConfig{
			APIBaseURL: "https://example.invalid",
		},
	})
	return ex, fs, serversRoot
}

func TestExecutor_FSReadWrite(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	want := []byte("hello world\n")
	writeRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_write",
		Args: map[string]any{
			"path": "server1/hello.txt",
			"b64":  base64.StdEncoding.EncodeToString(want),
		},
	})
	if !writeRes.OK {
		t.Fatalf("fs_write failed: %s", writeRes.Error)
	}

	readRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_read",
		Args: map[string]any{"path": "server1/hello.txt"},
	})
	if !readRes.OK {
		t.Fatalf("fs_read failed: %s", readRes.Error)
	}
	gotB64, _ := readRes.Output["b64"].(string)
	got, err := base64.StdEncoding.DecodeString(gotB64)
	if err != nil {
		t.Fatalf("decode b64: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("unexpected contents: %q", string(got))
	}
}

func TestExecutor_FSCopy_File_NoOverwrite(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	want := []byte("hello world\n")
	writeRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_write",
		Args: map[string]any{
			"path": "server1/a.txt",
			"b64":  base64.StdEncoding.EncodeToString(want),
		},
	})
	if !writeRes.OK {
		t.Fatalf("fs_write failed: %s", writeRes.Error)
	}

	copyRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_copy",
		Args: map[string]any{"from": "server1/a.txt", "to": "server1/b.txt"},
	})
	if !copyRes.OK {
		t.Fatalf("fs_copy failed: %s", copyRes.Error)
	}

	readRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_read",
		Args: map[string]any{"path": "server1/b.txt"},
	})
	if !readRes.OK {
		t.Fatalf("fs_read failed: %s", readRes.Error)
	}
	gotB64, _ := readRes.Output["b64"].(string)
	got, err := base64.StdEncoding.DecodeString(gotB64)
	if err != nil {
		t.Fatalf("decode b64: %v", err)
	}
	if string(got) != string(want) {
		t.Fatalf("unexpected contents: %q", string(got))
	}

	copyAgain := ex.Execute(ctx, protocol.Command{
		Name: "fs_copy",
		Args: map[string]any{"from": "server1/a.txt", "to": "server1/b.txt"},
	})
	if copyAgain.OK {
		t.Fatalf("expected no-overwrite behavior")
	}
}

func TestExecutor_FSStat_File(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	want := []byte("hello world\n")
	writeRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_write",
		Args: map[string]any{
			"path": "server1/a.txt",
			"b64":  base64.StdEncoding.EncodeToString(want),
		},
	})
	if !writeRes.OK {
		t.Fatalf("fs_write failed: %s", writeRes.Error)
	}

	statRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_stat",
		Args: map[string]any{"path": "server1/a.txt"},
	})
	if !statRes.OK {
		t.Fatalf("fs_stat failed: %s", statRes.Error)
	}
	if statRes.Output == nil {
		t.Fatalf("expected output")
	}
	if isDir, _ := statRes.Output["isDir"].(bool); isDir {
		t.Fatalf("expected file")
	}
	if size, _ := statRes.Output["size"].(int64); size <= 0 {
		if sizef, ok := statRes.Output["size"].(float64); !ok || sizef <= 0 {
			t.Fatalf("expected size")
		}
	}
	if mode, _ := statRes.Output["mode"].(string); strings.TrimSpace(mode) == "" {
		t.Fatalf("expected mode string")
	}
}

func TestExecutor_FSHash_SHA256(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	want := []byte("hello world\n")
	writeRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_write",
		Args: map[string]any{
			"path": "server1/a.txt",
			"b64":  base64.StdEncoding.EncodeToString(want),
		},
	})
	if !writeRes.OK {
		t.Fatalf("fs_write failed: %s", writeRes.Error)
	}

	h := sha256.Sum256(want)
	wantHex := hex.EncodeToString(h[:])

	hashRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_hash",
		Args: map[string]any{"path": "server1/a.txt"},
	})
	if !hashRes.OK {
		t.Fatalf("fs_hash failed: %s", hashRes.Error)
	}
	gotHex, _ := hashRes.Output["sha256"].(string)
	if gotHex != wantHex {
		t.Fatalf("unexpected sha256: got=%q want=%q", gotHex, wantHex)
	}
}

func TestExecutor_FSSearch_Content(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	write := func(p string, b []byte) {
		res := ex.Execute(ctx, protocol.Command{
			Name: "fs_write",
			Args: map[string]any{
				"path": p,
				"b64":  base64.StdEncoding.EncodeToString(b),
			},
		})
		if !res.OK {
			t.Fatalf("fs_write failed: %s", res.Error)
		}
	}

	write("server1/a.txt", []byte("hello world\nfoo\n"))
	write("server1/sub/b.txt", []byte("nothing\nhello again\n"))
	write("server1/c.yml", []byte("hello: yaml\n"))

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_search",
		Args: map[string]any{
			"path":           "server1",
			"pattern":        "*.txt",
			"query":          "hello",
			"regex":          false,
			"case_sensitive": false,
			"recursive":      true,
			"max_files":      50,
			"max_matches":    50,
			"context_before": 1,
			"context_after":  1,
		},
	})
	if !res.OK {
		t.Fatalf("fs_search failed: %s", res.Error)
	}

	rawMatches := res.Output["matches"]
	var matches []map[string]any
	switch v := rawMatches.(type) {
	case []map[string]any:
		matches = v
	case []any:
		for _, it := range v {
			m, ok := it.(map[string]any)
			if ok {
				matches = append(matches, m)
			}
		}
	default:
		t.Fatalf("unexpected matches type: %T", rawMatches)
	}
	if len(matches) != 2 {
		t.Fatalf("unexpected matches len: got=%d", len(matches))
	}

	paths := make(map[string]bool)
	for _, m := range matches {
		p, _ := m["path"].(string)
		paths[p] = true
	}
	if !paths["server1/a.txt"] || !paths["server1/sub/b.txt"] {
		t.Fatalf("unexpected match paths: %#v", paths)
	}
}

func TestExecutor_FSSearch_NameOnly(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_write",
		Args: map[string]any{
			"path": "server1/a.txt",
			"b64":  base64.StdEncoding.EncodeToString([]byte("hello\n")),
		},
	})
	if !res.OK {
		t.Fatalf("fs_write failed: %s", res.Error)
	}

	searchRes := ex.Execute(ctx, protocol.Command{
		Name: "fs_search",
		Args: map[string]any{
			"path":      "server1",
			"pattern":   "*.txt",
			"query":     "",
			"recursive": true,
		},
	})
	if !searchRes.OK {
		t.Fatalf("fs_search failed: %s", searchRes.Error)
	}
	rawFiles := searchRes.Output["files"]
	var files []map[string]any
	switch v := rawFiles.(type) {
	case []map[string]any:
		files = v
	case []any:
		for _, it := range v {
			m, ok := it.(map[string]any)
			if ok {
				files = append(files, m)
			}
		}
	default:
		t.Fatalf("unexpected files type: %T", rawFiles)
	}
	if len(files) != 1 {
		t.Fatalf("unexpected files len: got=%d", len(files))
	}
	if p, _ := files[0]["path"].(string); p != "server1/a.txt" {
		t.Fatalf("unexpected file path: %q", p)
	}
}

func TestExecutor_FSRead_RejectsEscape(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_read",
		Args: map[string]any{"path": "../oops.txt"},
	})
	if res.OK {
		t.Fatalf("expected failure")
	}
	if res.Error == "" {
		t.Fatalf("expected error message")
	}
}

func TestExecutor_FSUnzip_RejectsSymlink(t *testing.T) {
	ex, fs, serversRoot := newTestExecutor(t)
	ctx := context.Background()

	zipAbs := filepath.Join(serversRoot, "test.zip")
	f, err := os.Create(zipAbs)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	zw := zip.NewWriter(f)
	hdr := &zip.FileHeader{Name: "link"}
	hdr.SetMode(os.ModeSymlink | 0o777)
	w, err := zw.CreateHeader(hdr)
	if err != nil {
		t.Fatalf("zip header: %v", err)
	}
	_, _ = w.Write([]byte("target"))
	_ = zw.Close()
	_ = f.Close()

	// Ensure zip is visible under the sandbox root.
	if _, err := fs.Resolve("test.zip"); err != nil {
		t.Fatalf("resolve zip: %v", err)
	}

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_unzip",
		Args: map[string]any{
			"zip_path":    "test.zip",
			"dest_dir":    "server1",
			"instance_id": "server1",
		},
	})
	if res.OK {
		t.Fatalf("expected failure")
	}
	if res.Error == "" {
		t.Fatalf("expected error message")
	}
}

func TestExecutor_FSZipList_Basic(t *testing.T) {
	ex, fs, serversRoot := newTestExecutor(t)
	ctx := context.Background()

	zipAbs := filepath.Join(serversRoot, "test.zip")
	f, err := os.Create(zipAbs)
	if err != nil {
		t.Fatalf("create zip: %v", err)
	}
	zw := zip.NewWriter(f)
	w1, err := zw.Create("pack/a.txt")
	if err != nil {
		t.Fatalf("zip create: %v", err)
	}
	_, _ = w1.Write([]byte("a"))
	w2, err := zw.Create("pack/sub/b.txt")
	if err != nil {
		t.Fatalf("zip create: %v", err)
	}
	_, _ = w2.Write([]byte("bb"))
	_ = zw.Close()
	_ = f.Close()

	// Ensure zip is visible under the sandbox root.
	if _, err := fs.Resolve("test.zip"); err != nil {
		t.Fatalf("resolve zip: %v", err)
	}

	resStrip := ex.Execute(ctx, protocol.Command{
		Name: "fs_zip_list",
		Args: map[string]any{"zip_path": "test.zip", "strip_top_level": true},
	})
	if !resStrip.OK {
		t.Fatalf("fs_zip_list failed: %s", resStrip.Error)
	}
	entriesStrip, ok := resStrip.Output["entries"].([]zipListEntry)
	if !ok {
		t.Fatalf("expected entries slice")
	}
	paths := make([]string, 0, len(entriesStrip))
	for _, e := range entriesStrip {
		paths = append(paths, e.Path)
	}
	if strings.Join(paths, ",") != "a.txt,sub/b.txt" {
		t.Fatalf("paths=%q", strings.Join(paths, ","))
	}
	if top, _ := resStrip.Output["top_level_dir"].(string); top != "pack" {
		t.Fatalf("top_level_dir=%q", top)
	}
	if prefix, _ := resStrip.Output["strip_prefix"].(string); prefix != "pack/" {
		t.Fatalf("strip_prefix=%q", prefix)
	}
	if total, _ := resStrip.Output["total_bytes"].(uint64); total != 3 {
		t.Fatalf("total_bytes=%d", total)
	}

	resNoStrip := ex.Execute(ctx, protocol.Command{
		Name: "fs_zip_list",
		Args: map[string]any{"zip_path": "test.zip", "strip_top_level": false},
	})
	if !resNoStrip.OK {
		t.Fatalf("fs_zip_list failed: %s", resNoStrip.Error)
	}
	entriesNoStrip, ok := resNoStrip.Output["entries"].([]zipListEntry)
	if !ok {
		t.Fatalf("expected entries slice")
	}
	paths = paths[:0]
	for _, e := range entriesNoStrip {
		paths = append(paths, e.Path)
	}
	if strings.Join(paths, ",") != "pack/a.txt,pack/sub/b.txt" {
		t.Fatalf("paths=%q", strings.Join(paths, ","))
	}
	if prefix, _ := resNoStrip.Output["strip_prefix"].(string); prefix != "" {
		t.Fatalf("strip_prefix=%q", prefix)
	}
}

func TestExecutor_FSZip_SelectionMode_Basic(t *testing.T) {
	ex, fs, serversRoot := newTestExecutor(t)
	ctx := context.Background()

	instDir := filepath.Join(serversRoot, "server1")
	if err := os.MkdirAll(filepath.Join(instDir, "sub"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatalf("write a.txt: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "sub", "b.txt"), []byte("bb"), 0o644); err != nil {
		t.Fatalf("write b.txt: %v", err)
	}

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_zip",
		Args: map[string]any{
			"base_dir": "server1",
			"paths":    []string{"a.txt", "sub"},
		},
	})
	if !res.OK {
		t.Fatalf("fs_zip failed: %s", res.Error)
	}
	zipRel, _ := res.Output["zip_path"].(string)
	if zipRel == "" {
		t.Fatalf("expected zip_path")
	}
	if !strings.HasPrefix(zipRel, "_exports/") {
		t.Fatalf("zip_path=%q", zipRel)
	}
	if files, _ := res.Output["files"].(int); files != 2 {
		t.Fatalf("files=%d", files)
	}

	zipAbs, err := fs.Resolve(zipRel)
	if err != nil {
		t.Fatalf("resolve zip: %v", err)
	}
	zr, err := zip.OpenReader(zipAbs)
	if err != nil {
		t.Fatalf("open zip: %v", err)
	}
	defer zr.Close()

	got := map[string]bool{}
	for _, f := range zr.File {
		if f == nil || f.FileInfo().IsDir() {
			continue
		}
		got[strings.ReplaceAll(f.Name, "\\", "/")] = true
	}
	if !got["a.txt"] || !got["sub/b.txt"] {
		t.Fatalf("zip entries=%v", got)
	}
}

func TestExecutor_FSZip_SelectionMode_RejectsTraversal(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_zip",
		Args: map[string]any{
			"base_dir": "server1",
			"paths":    []string{"../oops"},
		},
	})
	if res.OK {
		t.Fatalf("expected failure")
	}
	if strings.TrimSpace(res.Error) == "" {
		t.Fatalf("expected error")
	}
}

func TestExecutor_FSZip_SelectionMode_RejectsSymlink(t *testing.T) {
	ex, _, serversRoot := newTestExecutor(t)
	ctx := context.Background()

	instDir := filepath.Join(serversRoot, "server1")
	if err := os.MkdirAll(instDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "a.txt"), []byte("a"), 0o644); err != nil {
		t.Fatalf("write a.txt: %v", err)
	}
	if err := os.Symlink("a.txt", filepath.Join(instDir, "link")); err != nil {
		// Not all environments support creating symlinks.
		t.Skipf("symlink not supported: %v", err)
	}

	res := ex.Execute(ctx, protocol.Command{
		Name: "fs_zip",
		Args: map[string]any{
			"base_dir": "server1",
			"paths":    []string{"link"},
		},
	})
	if res.OK {
		t.Fatalf("expected failure")
	}
	if strings.TrimSpace(res.Error) == "" {
		t.Fatalf("expected error")
	}
}

func TestExecutor_MCBackupRestore_Roundtrip(t *testing.T) {
	ex, _, serversRoot := newTestExecutor(t)
	ctx := context.Background()

	// Seed an instance folder.
	instDir := filepath.Join(serversRoot, "server1")
	if err := os.MkdirAll(filepath.Join(instDir, "world"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "server.properties"), []byte("server-port=25565\n"), 0o644); err != nil {
		t.Fatalf("write props: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "world", "level.dat"), []byte("data"), 0o644); err != nil {
		t.Fatalf("write world: %v", err)
	}

	backupRes := ex.Execute(ctx, protocol.Command{
		Name: "mc_backup",
		Args: map[string]any{
			"instance_id": "server1",
			"backup_name": "b1.zip",
			"stop":        false,
		},
	})
	if !backupRes.OK {
		t.Fatalf("mc_backup failed: %s", backupRes.Error)
	}
	zipRel, _ := backupRes.Output["path"].(string)
	if zipRel == "" {
		t.Fatalf("expected backup path")
	}

	// Destroy instance, then restore.
	_ = os.RemoveAll(instDir)
	if err := os.MkdirAll(instDir, 0o755); err != nil {
		t.Fatalf("mkdir after delete: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "server.properties"), []byte("server-port=25566\n"), 0o644); err != nil {
		t.Fatalf("write modified props: %v", err)
	}

	restoreRes := ex.Execute(ctx, protocol.Command{
		Name: "mc_restore",
		Args: map[string]any{
			"instance_id": "server1",
			"zip_path":    zipRel,
		},
	})
	if !restoreRes.OK {
		t.Fatalf("mc_restore failed: %s", restoreRes.Error)
	}

	b, err := os.ReadFile(filepath.Join(instDir, "server.properties"))
	if err != nil {
		t.Fatalf("read restored props: %v", err)
	}
	if string(b) != "server-port=25565\n" {
		t.Fatalf("unexpected restored props: %q", string(b))
	}
}

func TestExecutor_MCTemplates(t *testing.T) {
	ex, _, _ := newTestExecutor(t)
	ctx := context.Background()

	res := ex.Execute(ctx, protocol.Command{Name: "mc_templates"})
	if !res.OK {
		t.Fatalf("mc_templates failed: %s", res.Error)
	}
	if res.Output == nil {
		t.Fatalf("expected output")
	}
	if _, ok := res.Output["templates"]; !ok {
		t.Fatalf("expected templates key")
	}
}

func TestExecutor_MCDetectJar_PicksServerJar(t *testing.T) {
	ex, _, serversRoot := newTestExecutor(t)
	ctx := context.Background()

	instDir := filepath.Join(serversRoot, "server1")
	if err := os.MkdirAll(filepath.Join(instDir, "sub"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "server.jar"), []byte("jar"), 0o644); err != nil {
		t.Fatalf("write server.jar: %v", err)
	}
	if err := os.WriteFile(filepath.Join(instDir, "sub", "other.jar"), []byte("jar2"), 0o644); err != nil {
		t.Fatalf("write other.jar: %v", err)
	}

	res := ex.Execute(ctx, protocol.Command{
		Name: "mc_detect_jar",
		Args: map[string]any{"instance_id": "server1"},
	})
	if !res.OK {
		t.Fatalf("mc_detect_jar failed: %s", res.Error)
	}
	best, _ := res.Output["best"].(string)
	if best != "server.jar" {
		t.Fatalf("best=%q want %q", best, "server.jar")
	}
}
