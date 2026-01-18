package commands

import (
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"

	"elegantmc/daemon/internal/protocol"
)

type jarHit struct {
	Rel   string
	Size  int64
	Depth int
	Score int
}

func (e *Executor) mcDetectJar(cmd protocol.Command) protocol.CommandResult {
	instanceID, _ := asString(cmd.Args["instance_id"])
	if strings.TrimSpace(instanceID) == "" {
		return fail("instance_id is required")
	}
	if err := validateInstanceID(instanceID); err != nil {
		return fail(err.Error())
	}
	if e.deps.FS == nil {
		return fail("servers filesystem not configured")
	}

	maxDepth := 4
	if v, ok := cmd.Args["max_depth"]; ok {
		if n, err := asInt(v); err == nil {
			if n < 1 {
				maxDepth = 1
			} else if n > 10 {
				maxDepth = 10
			} else {
				maxDepth = n
			}
		}
	}

	instAbs, err := e.deps.FS.Resolve(instanceID)
	if err != nil {
		return fail(err.Error())
	}
	if _, err := os.Stat(instAbs); err != nil {
		if os.IsNotExist(err) {
			return ok(map[string]any{"instance_id": instanceID, "best": "", "jars": []string{}})
		}
		return fail(err.Error())
	}

	skipDirs := map[string]bool{
		"mods":          true,
		"plugins":       true,
		"libraries":     true,
		"config":        true,
		"world":         true,
		"logs":          true,
		"crash-reports": true,
		"resourcepacks": true,
		"shaderpacks":   true,
		"_backups":      true,
		".elegantmc_tmp": true,
	}

	var hits []jarHit
	var walk func(rel, abs string, depth int) error
	walk = func(rel, abs string, depth int) error {
		entries, err := os.ReadDir(abs)
		if err != nil {
			return err
		}
		for _, ent := range entries {
			name := ent.Name()
			if ent.IsDir() {
				if skipDirs[name] {
					continue
				}
				if depth+1 > maxDepth {
					continue
				}
				nextRel := filepath.Join(rel, name)
				nextAbs := filepath.Join(abs, name)
				if err := walk(nextRel, nextAbs, depth+1); err != nil {
					return err
				}
				continue
			}

			if !strings.HasSuffix(strings.ToLower(name), ".jar") {
				continue
			}

			info, _ := ent.Info()
			var size int64
			if info != nil {
				size = info.Size()
			}
			jarRel := path.Clean(filepath.ToSlash(filepath.Join(rel, name)))
			if jarRel == "." || jarRel == "/" {
				jarRel = name
			}
			depthCount := 0
			if jarRel != "" {
				depthCount = strings.Count(jarRel, "/")
			}
			hits = append(hits, jarHit{
				Rel:   jarRel,
				Size:  size,
				Depth: depthCount,
				Score: scoreJarCandidate(jarRel, size, depthCount),
			})
		}
		return nil
	}

	if err := walk("", instAbs, 0); err != nil {
		return fail(err.Error())
	}

	sort.Slice(hits, func(i, j int) bool {
		if hits[i].Score != hits[j].Score {
			return hits[i].Score > hits[j].Score
		}
		if hits[i].Depth != hits[j].Depth {
			return hits[i].Depth < hits[j].Depth
		}
		if hits[i].Size != hits[j].Size {
			return hits[i].Size > hits[j].Size
		}
		return hits[i].Rel < hits[j].Rel
	})

	jars := make([]string, 0, len(hits))
	for _, h := range hits {
		jars = append(jars, h.Rel)
	}

	best := ""
	if len(hits) > 0 {
		best = hits[0].Rel
	}

	return ok(map[string]any{
		"instance_id": instanceID,
		"best":        best,
		"jars":        jars,
	})
}

func scoreJarCandidate(rel string, size int64, depth int) int {
	r := strings.TrimPrefix(path.Clean(rel), "/")
	base := strings.ToLower(path.Base(r))
	score := 0

	if base == "server.jar" {
		score += 1000
	}
	if strings.Contains(base, "server") {
		score += 80
	}
	if strings.Contains(base, "fabric") || strings.Contains(base, "quilt") {
		score += 50
	}
	if strings.Contains(base, "forge") || strings.Contains(base, "neoforge") {
		score += 50
	}
	if strings.Contains(base, "installer") {
		score -= 120
	}
	if strings.Contains(base, "client") {
		score -= 120
	}

	// Prefer shallower paths.
	score -= depth * 5

	// Prefer larger jars a bit (server jars tend to be larger than small helper jars).
	if size > 0 {
		mb := int(size / (1024 * 1024))
		if mb > 200 {
			mb = 200
		}
		score += mb
	}

	return score
}

