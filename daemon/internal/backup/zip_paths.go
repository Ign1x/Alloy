package backup

import (
	"archive/zip"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ZipPaths zips a set of relative paths under baseDir into destZipPath.
// The archive contains paths relative to baseDir (no leading slash) and refuses to follow symlinks.
func ZipPaths(baseDir string, relPaths []string, destZipPath string) (int, error) {
	baseAbs, err := filepath.Abs(baseDir)
	if err != nil {
		return 0, err
	}
	info, err := os.Stat(baseAbs)
	if err != nil {
		return 0, err
	}
	if !info.IsDir() {
		return 0, errors.New("baseDir is not a directory")
	}
	if strings.TrimSpace(destZipPath) == "" {
		return 0, errors.New("destZipPath is empty")
	}

	// Clean and stabilize input order for deterministic zips.
	items := make([]string, 0, len(relPaths))
	for _, raw := range relPaths {
		s := strings.TrimSpace(raw)
		if s == "" || s == "." || s == ".." {
			continue
		}
		items = append(items, s)
	}
	if len(items) == 0 {
		return 0, errors.New("no paths to zip")
	}
	sort.Strings(items)

	tmp := destZipPath + ".partial"
	_ = os.Remove(tmp)
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	zw := zip.NewWriter(f)
	committed := false
	defer func() {
		if zw != nil {
			_ = zw.Close()
		}
		if f != nil {
			_ = f.Close()
		}
		if !committed {
			_ = os.Remove(tmp)
		}
	}()

	files := 0
	seen := map[string]struct{}{}
	for _, raw := range items {
		relClean := filepath.Clean(filepath.FromSlash(raw))
		if relClean == "." || strings.TrimSpace(relClean) == "" {
			return 0, errors.New("invalid path")
		}

		// Prevent traversal attempts before/after join.
		if relClean == ".." || strings.HasPrefix(relClean, ".."+string(os.PathSeparator)) {
			return 0, errors.New("path escapes base")
		}
		if filepath.IsAbs(relClean) || filepath.VolumeName(relClean) != "" {
			return 0, errors.New("absolute paths are not allowed")
		}

		itemAbs := filepath.Join(baseAbs, relClean)
		itemAbs = filepath.Clean(itemAbs)
		if !hasPathPrefix(itemAbs, baseAbs) {
			return 0, errors.New("path escapes base")
		}

		// Walk the selected root (file or directory).
		walkErr := filepath.WalkDir(itemAbs, func(p string, d os.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}

			rel, err := filepath.Rel(baseAbs, p)
			if err != nil {
				return err
			}
			rel = filepath.ToSlash(rel)
			if rel == "." {
				// base dir itself should never be selected, but keep safe.
				return nil
			}
			if strings.HasPrefix(rel, "/") || strings.HasPrefix(rel, "../") || strings.Contains(rel, "../") {
				return errors.New("path escapes base")
			}

			// Refuse symlinks.
			if d.Type()&os.ModeSymlink != 0 {
				return errors.New("refuse to zip symlink")
			}

			info, err := d.Info()
			if err != nil {
				return err
			}

			if info.IsDir() {
				// Add a directory entry for nicer tools (optional).
				name := rel + "/"
				if _, ok := seen[name]; ok {
					return nil
				}
				seen[name] = struct{}{}
				hdr, err := zip.FileInfoHeader(info)
				if err != nil {
					return err
				}
				hdr.Name = name
				hdr.Method = zip.Store
				_, err = zw.CreateHeader(hdr)
				return err
			}

			if _, ok := seen[rel]; ok {
				return nil
			}
			seen[rel] = struct{}{}

			hdr, err := zip.FileInfoHeader(info)
			if err != nil {
				return err
			}
			hdr.Name = rel
			hdr.Method = zip.Deflate
			w, err := zw.CreateHeader(hdr)
			if err != nil {
				return err
			}

			src, err := os.Open(p)
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(w, src)
			_ = src.Close()
			if copyErr != nil {
				return copyErr
			}
			files++
			return nil
		})
		if walkErr != nil {
			return 0, walkErr
		}
	}

	if err := zw.Close(); err != nil {
		return 0, err
	}
	zw = nil
	if err := f.Close(); err != nil {
		return 0, err
	}
	f = nil
	if err := os.Chmod(tmp, 0o644); err != nil {
		return 0, err
	}
	if err := os.Rename(tmp, destZipPath); err != nil {
		return 0, err
	}
	committed = true
	return files, nil
}
