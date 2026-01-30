# Alloy WORKFLOW

This repository is being rebooted as **Alloy** (a full rewrite of ElegantMC).

Core goals:
- B/S architecture, fully Dockerized deployment
- Backend: Rust (Tokio + Axum + SeaORM)
- Internal communication: gRPC (Tonic)
- Frontend: SolidJS + Tailwind CSS v4 + Vite
- Glue: rspc for end-to-end TypeScript type safety (no manual TS type definitions)

Key architectural interpretation (explicit):
- Browser -> Control Plane: **rspc** over HTTP/WS (for end-to-end TS types)
- Control Plane -> Agent/Runner: **gRPC (Tonic)** (service-to-service)

Repo layout (target):
```text
crates/
  alloy-core/        # Domain models + traits (ports)
  alloy-proto/       # .proto + generated Rust types
  alloy-agent/       # Game runner (gRPC server)
  alloy-control/     # Control plane (Axum + rspc + DB + gRPC client)
  alloy-db/          # SeaORM entities + repos (adapters)
  alloy-migration/   # SeaORM migrations
web/                 # SolidJS app (Vite + Tailwind v4)
```

Commit rules (strict):
- Before implementing any feature/fix: update this file's TODO list.
- After each small feature/fix: **immediately** `git commit`.
- Commit messages are **Chinese + English**, e.g.
  - `feat(core): <中文描述> / <English description>`

---

## TODO

### Decisions (recorded)
- [x] Package manager: npm
- [x] Database: no DB for the initial vertical slice (SeaORM is deferred until persistence is needed)
- [x] rspc transport (web <-> control): FetchTransport over HTTP

### Phase 0 - Bootstrap
- [x] Wipe legacy code and reset repo (keep git history)
- [x] Create `WORKFLOW.md`
- [x] Confirm the rspc+gRPC boundary is acceptable (no gRPC in browsers; rspc provides TS types)
- [x] Initialize Rust workspace skeleton (crates + basic build)
- [x] Add basic formatting/lint (rustfmt, clippy) and CI
  - [x] Add `.editorconfig`
  - [x] Add GitHub Actions CI (fmt, clippy, test)

### Phase 0.5 - Vertical slice (no DB)
- [x] Add rspc router + TS bindings export in `crates/alloy-control`
- [x] Web consumes generated bindings and calls `control.ping` (procedure key is `control.ping`)
- [x] Control exposes `agent.health` (rspc) by calling `alloy-agent` gRPC health
- [x] Web shows agent health end-to-end (rspc -> control -> gRPC -> agent)

### Phase 0.6 - Dockerized vertical slice (no DB)
Definition of Done (must be true):
- `docker compose -f deploy/docker-compose.yml up -d --build` starts cleanly
- Web is served on host `:3000` (optional: map to host `:80` via override)
- Web calls `/rspc` on the same origin (no CORS)
- Control calls Agent via gRPC using container DNS, not `127.0.0.1`
- Verification commands in `deploy/README.md` succeed

TODO:
- [x] Add `deploy/README.md` with Docker runbook + verification commands
- [x] Make `alloy-control` use `ALLOY_AGENT_ENDPOINT` for gRPC target
- [x] Add `.dockerignore`
- [x] Add Rust Dockerfiles: `deploy/agent.Dockerfile`, `deploy/control.Dockerfile`
- [x] Add web Dockerfile + nginx config proxying `/rspc` -> control
- [x] Add `deploy/docker-compose.yml` to run `web` + `alloy-control` + `alloy-agent`
- [x] Verify end-to-end via compose and check off this section

### Phase 1 - Core domain + multi-game abstraction
Definition of Done (must be true):
- Agent can start/stop/list processes via gRPC (no Minecraft assumptions)
- Control exposes `process.*` via rspc (types are generated, committed)
- Web can start a process (from a safe template), stop it, and view status
- No DB; state is in-memory (agent restart clears process table)

TODO:
- [x] Add Phase 1 protos: `ProcessService` (start/stop/status/list)
- [x] Add domain crate for process supervision types and policies
- [x] Implement `ProcessManager` in `alloy-agent` (graceful stop with timeout)
- [x] Bridge `ProcessService` through `alloy-control` to rspc `process.*`
- [x] Web UI: process list + start/stop/status

Notes:
- Safety: web/control do NOT accept arbitrary `cmd`; use `ProcessKind` templates enforced by agent

### Phase 2 - Agent (gRPC)
- [x] Define gRPC protos: health, instance lifecycle, logs, filesystem APIs
  - [x] Create `alloy-proto` codegen crate (build.rs + proto files)
  - [x] Filesystem API (agent): list/read small files under a scoped root
  - [x] Logs API (agent): tail file + cursor model (beyond process-only)
  - [x] Instance lifecycle API (agent): create/start/stop/delete instance (game-aware)
- [x] Implement `alloy-agent` gRPC server skeleton
  - [x] Implement `AgentHealthService` and listen on :50051

### Phase 3 - Control plane (Axum + rspc + DB)
- [ ] DB schema design (SeaORM): users, nodes, instances, games, tokens (DEFERRED)
  - [ ] Auth/session model (cookie/JWT) and security policy
  - [ ] rspc router skeleton + TS bindings generation strategy
  - [x] Implement basic Axum server + `/healthz`

### Phase 4 - Web UI (SolidJS)
- [x] Scaffold SolidJS + Tailwind v4 (Vite)
- [ ] Login + dashboard + node list
  - [x] Instance manager (create/list/start/stop/delete)
  - [ ] File explorer (fs.listDir/fs.readFile)
  - [ ] Log viewer (log.tailFile)

### Phase 5 - Game plugins
- [ ] Minecraft adapter (parity with legacy core features)
- [ ] Terraria adapter (prove multi-game extensibility)

---

## Milestone 1 - Minecraft Vanilla (real)
Definition of Done (must be true):
- Agent exposes a template `minecraft:vanilla` (no arbitrary cmd from web/control)
- Agent downloads vanilla server.jar from Mojang piston-meta, verifies sha1, caches it under a persistent data root
- Agent creates an instance dir, writes `eula.txt` after explicit acceptance, and sets `server.properties` (server-port)
- Start/stop works end-to-end from web UI, logs are visible via tail, and stop is graceful (stdin `stop\n`) with TERM/KILL fallback
- Docker compose mounts persistent `/data` for agent (instance+cache) and publishes port `25565`

Defaults (recorded):
- EULA: require explicit `accept_eula=true` in params
- Java: agent image ships Java 21 (Temurin) and checks Mojang `javaVersion.majorVersion` against the local runtime
- Port: 25565 (configurable in params)
- Memory: `memory_mb` integer (default 2048)

TODO:
- [x] Add `minecraft:vanilla` template and param validation in agent
- [x] Implement Mojang manifest resolve + jar download/cache + sha1 verify
- [x] Create instance layout under `ALLOY_DATA_ROOT` and write `eula.txt` + `server.properties`
- [x] Start server via `java -Xmx${memory_mb}M -jar server.jar nogui` in instance dir
- [x] Stop via stdin `stop\n` then TERM/KILL fallback
- [x] Update Docker agent image to include Java 21 and mount `/data`
- [x] Update web UI: add minecraft start form (version/port/memory/eula)
- [x] Verify end-to-end in docker-compose and check off this section
