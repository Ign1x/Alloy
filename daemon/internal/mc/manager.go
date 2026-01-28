package mc

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"elegantmc/daemon/internal/sandbox"
)

type ManagerConfig struct {
	ServersFS              *sandbox.FS
	Log                    *log.Logger
	JavaCandidates         []string
	JavaAutoDownload       bool
	JavaCacheDir           string
	JavaAdoptiumAPIBaseURL string
}

type Manager struct {
	cfg ManagerConfig

	mu        sync.Mutex
	instances map[string]*Instance

	java        *javaSelector
	javaRuntime *JavaRuntimeManager
}

type Instance struct {
	ID string

	mu                sync.Mutex
	cmd               *exec.Cmd
	stdin             io.WriteCloser
	done              chan error
	portKey           string
	jarRel            string
	java              string
	javaMajor         int
	requiredJavaMajor int
	args              []string
	startedAt         time.Time
	lastExitUnix      int64
	lastExitCode      *int
	lastExitSignal    string
}

type StartOptions struct {
	InstanceID string
	JarPath    string
	JavaPath   string
	Xms        string
	Xmx        string
	JvmArgs    []string
	ExtraArgs  []string
}

type Status struct {
	Running           bool
	PID               int
	JarRel            string
	Java              string
	JavaMajor         int
	RequiredJavaMajor int
	LastExitUnix      int64
	LastExitCode      *int
	LastExitSignal    string
}

// ResolvedStart describes the exact command Daemon would use for mc_start,
// without actually starting the process.
type ResolvedStart struct {
	InstanceID         string
	InstanceDir        string
	JarRel             string
	JarAbs             string
	Java               string
	JavaSource         string
	JavaMajor          int
	RequiredJavaMajor  int
	Args               []string
	Argv               []string
	CmdPosix           string
}

func NewManager(cfg ManagerConfig) *Manager {
	var rt *JavaRuntimeManager
	if cfg.JavaAutoDownload {
		rt = NewJavaRuntimeManager(JavaRuntimeManagerConfig{
			CacheDir:           cfg.JavaCacheDir,
			AdoptiumAPIBaseURL: cfg.JavaAdoptiumAPIBaseURL,
			Log:                cfg.Log,
		})
	}
	return &Manager{
		cfg:         cfg,
		instances:   make(map[string]*Instance),
		java:        newJavaSelector(cfg.JavaCandidates),
		javaRuntime: rt,
	}
}

func (m *Manager) JavaRuntimeManager() *JavaRuntimeManager {
	return m.javaRuntime
}

func (m *Manager) List() map[string]Status {
	m.mu.Lock()
	defer m.mu.Unlock()

	out := make(map[string]Status, len(m.instances))
	for id, inst := range m.instances {
		out[id] = inst.Status()
	}
	return out
}

func (m *Manager) Start(ctx context.Context, opt StartOptions, logSink func(instanceID, stream, line string)) error {
	if strings.TrimSpace(opt.InstanceID) == "" {
		return errors.New("instance_id is required")
	}
	if strings.TrimSpace(opt.JarPath) == "" {
		return errors.New("jar_path is required")
	}

	m.mu.Lock()
	inst := m.instances[opt.InstanceID]
	if inst == nil {
		inst = &Instance{ID: opt.InstanceID}
		m.instances[opt.InstanceID] = inst
	}
	m.mu.Unlock()

	return inst.start(ctx, m.cfg.ServersFS, opt, logSink, m.cfg.Log, m.java, m.javaRuntime)
}

// ResolveStart computes the final java executable and argv for starting an instance.
// It does not reserve ports, write files, or start processes.
func (m *Manager) ResolveStart(ctx context.Context, opt StartOptions) (ResolvedStart, error) {
	if strings.TrimSpace(opt.InstanceID) == "" {
		return ResolvedStart{}, errors.New("instance_id is required")
	}
	if strings.TrimSpace(opt.JarPath) == "" {
		return ResolvedStart{}, errors.New("jar_path is required")
	}
	if m.cfg.ServersFS == nil {
		return ResolvedStart{}, errors.New("servers filesystem not configured")
	}

	instanceDir, err := m.cfg.ServersFS.Resolve(filepath.Join(opt.InstanceID))
	if err != nil {
		return ResolvedStart{}, err
	}
	jarAbs, err := m.cfg.ServersFS.Resolve(filepath.Join(opt.InstanceID, opt.JarPath))
	if err != nil {
		return ResolvedStart{}, err
	}
	if _, err := os.Stat(jarAbs); err != nil {
		return ResolvedStart{}, fmt.Errorf("jar not found: %w", err)
	}

	java, javaSource, javaMajor, requiredMajor, args, err := prepareStartCommand(ctx, jarAbs, opt, nil, m.cfg.Log, m.java, m.javaRuntime)
	if err != nil {
		return ResolvedStart{}, err
	}
	argv := append([]string{java}, args...)

	return ResolvedStart{
		InstanceID:        opt.InstanceID,
		InstanceDir:       instanceDir,
		JarRel:            opt.JarPath,
		JarAbs:            jarAbs,
		Java:              java,
		JavaSource:        javaSource,
		JavaMajor:         javaMajor,
		RequiredJavaMajor: requiredMajor,
		Args:              args,
		Argv:              argv,
		CmdPosix:          posixShellJoin(argv),
	}, nil
}

func (m *Manager) Stop(ctx context.Context, instanceID string) error {
	m.mu.Lock()
	inst := m.instances[instanceID]
	m.mu.Unlock()
	if inst == nil {
		return nil
	}
	return inst.stop(ctx, m.cfg.Log)
}

func (m *Manager) Delete(ctx context.Context, instanceID string) error {
	// Best-effort stop.
	_ = m.Stop(ctx, instanceID)

	m.mu.Lock()
	delete(m.instances, instanceID)
	m.mu.Unlock()

	if m.cfg.ServersFS == nil {
		return errors.New("servers filesystem not configured")
	}
	abs, err := m.cfg.ServersFS.Resolve(instanceID)
	if err != nil {
		return err
	}
	if err := os.RemoveAll(abs); err != nil {
		return err
	}
	if m.cfg.Log != nil {
		m.cfg.Log.Printf("mc deleted: instance=%s", instanceID)
	}
	return nil
}

func (m *Manager) SendConsole(ctx context.Context, instanceID string, line string) error {
	m.mu.Lock()
	inst := m.instances[instanceID]
	m.mu.Unlock()
	if inst == nil {
		return errors.New("unknown instance")
	}
	return inst.sendConsole(ctx, line)
}

func (inst *Instance) Status() Status {
	inst.mu.Lock()
	defer inst.mu.Unlock()

	if inst.cmd == nil || inst.cmd.Process == nil {
		return Status{
			Running:           false,
			JarRel:            inst.jarRel,
			Java:              inst.java,
			JavaMajor:         inst.javaMajor,
			RequiredJavaMajor: inst.requiredJavaMajor,
			LastExitUnix:      inst.lastExitUnix,
			LastExitCode:      inst.lastExitCode,
			LastExitSignal:    inst.lastExitSignal,
		}
	}
	return Status{
		Running:           true,
		PID:               inst.cmd.Process.Pid,
		JarRel:            inst.jarRel,
		Java:              inst.java,
		JavaMajor:         inst.javaMajor,
		RequiredJavaMajor: inst.requiredJavaMajor,
		LastExitUnix:      inst.lastExitUnix,
		LastExitCode:      inst.lastExitCode,
		LastExitSignal:    inst.lastExitSignal,
	}
}

func (inst *Instance) start(ctx context.Context, fs *sandbox.FS, opt StartOptions, logSink func(instanceID, stream, line string), logger *log.Logger, javaSel *javaSelector, javaRuntime *JavaRuntimeManager) error {
	inst.mu.Lock()
	defer inst.mu.Unlock()

	if inst.cmd != nil && inst.cmd.Process != nil {
		return errors.New("instance already running")
	}

	instanceDir, err := fs.Resolve(filepath.Join(opt.InstanceID))
	if err != nil {
		return err
	}
	if err := os.MkdirAll(instanceDir, 0o755); err != nil {
		return err
	}

	jarAbs, err := fs.Resolve(filepath.Join(opt.InstanceID, opt.JarPath))
	if err != nil {
		return err
	}
	if _, err := os.Stat(jarAbs); err != nil {
		return fmt.Errorf("jar not found: %w", err)
	}

	startedOk := false
	defer func() {
		if startedOk {
			return
		}
		if inst.portKey != "" {
			releasePort(inst.ID, inst.portKey)
			inst.portKey = ""
		}
	}()

	if host, port, ok := detectServerListenAddr(instanceDir); ok {
		key, err := reservePort(inst.ID, host, port)
		if err != nil {
			return err
		}
		inst.portKey = key
		if err := checkTCPPortAvailable(host, port); err != nil {
			return err
		}
	}

	java, _, selectedMajor, requiredMajor, args, err := prepareStartCommand(ctx, jarAbs, opt, logSink, logger, javaSel, javaRuntime)
	if err != nil {
		return err
	}

	inst.requiredJavaMajor = requiredMajor
	inst.javaMajor = selectedMajor

	cmd := exec.CommandContext(ctx, java, args...)
	cmd.Dir = instanceDir

	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	stdin, _ := cmd.StdinPipe()

	if err := cmd.Start(); err != nil {
		return err
	}

	done := make(chan error, 1)

	inst.cmd = cmd
	inst.stdin = stdin
	inst.done = done
	inst.jarRel = opt.JarPath
	inst.java = java
	inst.args = args
	inst.startedAt = time.Now()

	if logger != nil {
		logger.Printf("mc started: instance=%s pid=%d", inst.ID, cmd.Process.Pid)
	}

	if stdout != nil {
		go scanLines(stdout, func(line string) {
			if logSink != nil {
				logSink(inst.ID, "stdout", line)
			}
		})
	}
	if stderr != nil {
		go scanLines(stderr, func(line string) {
			if logSink != nil {
				logSink(inst.ID, "stderr", line)
			}
		})
	}

	go func() {
		err := cmd.Wait()

		exitUnix := time.Now().Unix()
		var exitCode *int
		if cmd.ProcessState != nil {
			code := cmd.ProcessState.ExitCode()
			if code >= 0 {
				exitCode = &code
			}
		}
		exitSignal := exitSignalFromProcessState(cmd.ProcessState)

		var portKey string
		inst.mu.Lock()
		inst.lastExitUnix = exitUnix
		inst.lastExitCode = exitCode
		inst.lastExitSignal = exitSignal
		inst.cmd = nil
		inst.stdin = nil
		inst.done = nil
		portKey = inst.portKey
		inst.portKey = ""
		inst.mu.Unlock()
		if portKey != "" {
			releasePort(inst.ID, portKey)
		}
		done <- err
		close(done)
		if err != nil && logger != nil {
			logger.Printf("mc exited: instance=%s err=%v", inst.ID, err)
		}
	}()

	startedOk = true
	return nil
}

func prepareStartCommand(
	ctx context.Context,
	jarAbs string,
	opt StartOptions,
	logSink func(instanceID, stream, line string),
	logger *log.Logger,
	javaSel *javaSelector,
	javaRuntime *JavaRuntimeManager,
) (java string, javaSource string, selectedMajor int, requiredMajor int, args []string, err error) {
	java = opt.JavaPath
	javaSource = "explicit"
	requiredMajor, err = requiredJavaMajorFromJar(jarAbs)
	detectedMajor := err == nil
	if err != nil {
		requiredMajor = 8
		if logger != nil {
			logger.Printf("mc: unable to detect required java from jar (instance=%s): %v", opt.InstanceID, err)
		}
	}
	if requiredMajor < 8 {
		requiredMajor = 8
	}

	if java == "" {
		if javaSel == nil {
			java = "java"
			javaSource = "default"
		} else {
			javaSource = "candidates"
			var selErr error
			java, selectedMajor, selErr = javaSel.Select(ctx, requiredMajor)
			if selErr != nil {
				if detectedMajor && javaRuntime != nil {
					if logSink != nil {
						logSink(opt.InstanceID, "stdout", fmt.Sprintf("[elegantmc] ensuring Temurin JRE %d (auto)", requiredMajor))
					}
					if ensuredJava, ensuredMajor, err := javaRuntime.EnsureTemurinJRE(ctx, requiredMajor); err == nil {
						java = ensuredJava
						selectedMajor = ensuredMajor
						javaSource = "temurin-auto"
						selErr = nil
					} else {
						if logger != nil {
							logger.Printf("mc: java auto-download failed (major=%d): %v", requiredMajor, err)
						}
						if logSink != nil {
							logSink(opt.InstanceID, "stdout", fmt.Sprintf("[elegantmc] java auto-download failed (major=%d): %v", requiredMajor, err))
						}
					}
				}
				if selErr != nil {
					return "", "", 0, 0, nil, selErr
				}
			}
			if detectedMajor && javaRuntime != nil && selectedMajor > 0 && selectedMajor < requiredMajor {
				if logSink != nil {
					logSink(opt.InstanceID, "stdout", fmt.Sprintf("[elegantmc] ensuring Temurin JRE %d (auto)", requiredMajor))
				}
				if ensuredJava, ensuredMajor, err := javaRuntime.EnsureTemurinJRE(ctx, requiredMajor); err == nil {
					java = ensuredJava
					selectedMajor = ensuredMajor
					javaSource = "temurin-auto"
				} else {
					if logger != nil {
						logger.Printf("mc: java auto-download failed (major=%d): %v", requiredMajor, err)
					}
					if logSink != nil {
						logSink(opt.InstanceID, "stdout", fmt.Sprintf("[elegantmc] java auto-download failed (major=%d): %v", requiredMajor, err))
					}
				}
			}
		}
	} else {
		if maj, err := probeJavaMajor(ctx, java); err == nil {
			selectedMajor = maj
		}
	}

	if logSink != nil {
		msg := fmt.Sprintf("[elegantmc] java=%s", java)
		if selectedMajor > 0 {
			msg += fmt.Sprintf(" (major %d)", selectedMajor)
		}
		if requiredMajor > 0 {
			msg += fmt.Sprintf(", required>=%d", requiredMajor)
		}
		if strings.TrimSpace(javaSource) != "" {
			msg += fmt.Sprintf(", source=%s", javaSource)
		}
		logSink(opt.InstanceID, "stdout", msg)
	}

	for _, a := range opt.JvmArgs {
		a = strings.TrimSpace(a)
		if a == "" {
			continue
		}
		args = append(args, a)
	}
	if opt.Xms != "" {
		args = append(args, "-Xms"+opt.Xms)
	}
	if opt.Xmx != "" {
		args = append(args, "-Xmx"+opt.Xmx)
	}
	args = append(args, "-jar", jarAbs, "nogui")
	args = append(args, opt.ExtraArgs...)
	return java, javaSource, selectedMajor, requiredMajor, args, nil
}

func posixShellJoin(argv []string) string {
	if len(argv) == 0 {
		return ""
	}
	parts := make([]string, 0, len(argv))
	for _, a := range argv {
		parts = append(parts, posixShellEscape(a))
	}
	return strings.Join(parts, " ")
}

func posixShellEscape(s string) string {
	// Safe enough for copy/paste into sh/bash/zsh. Not intended for Windows shells.
	if s == "" {
		return "''"
	}
	needQuotes := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c <= 0x20 || c == '\\' || c == '"' || c == '\'' || c == '$' || c == '`' || c == '!' || c == '|' || c == '&' || c == ';' || c == '<' || c == '>' || c == '(' || c == ')' || c == '{' || c == '}' || c == '[' || c == ']' || c == '*' || c == '?' {
			needQuotes = true
			break
		}
	}
	if !needQuotes {
		return s
	}
	// Single-quote and escape embedded quotes: ' -> '\''
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

func (inst *Instance) stop(ctx context.Context, logger *log.Logger) error {
	inst.mu.Lock()
	cmd := inst.cmd
	stdin := inst.stdin
	done := inst.done
	inst.mu.Unlock()

	if cmd == nil || cmd.Process == nil {
		return nil
	}
	if done == nil {
		_ = cmd.Process.Kill()
		return nil
	}

	if stdin != nil {
		_, _ = io.WriteString(stdin, "stop\n")
	}

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-done:
		if logger != nil {
			logger.Printf("mc stopped: instance=%s err=%v", inst.ID, err)
		}
		return nil
	case <-time.After(20 * time.Second):
		_ = cmd.Process.Kill()
		<-done
		if logger != nil {
			logger.Printf("mc killed: instance=%s", inst.ID)
		}
		return nil
	}
}

func (inst *Instance) sendConsole(ctx context.Context, line string) error {
	inst.mu.Lock()
	defer inst.mu.Unlock()
	if inst.stdin == nil {
		return errors.New("instance not running")
	}
	line = strings.TrimRight(line, "\r\n") + "\n"
	_, err := io.WriteString(inst.stdin, line)
	return err
}

func scanLines(r io.Reader, onLine func(string)) {
	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		if onLine != nil {
			onLine(scanner.Text())
		}
	}
}
