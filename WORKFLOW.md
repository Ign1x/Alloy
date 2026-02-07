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
- `docker compose up -d --build` starts cleanly
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
- [x] Add docker compose file to run `web` + `alloy-control` + `alloy-agent`
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
  - [x] Auth/session model (cookie/JWT) and security policy
  - [x] rspc router skeleton + TS bindings generation strategy
  - [x] Implement basic Axum server + `/healthz`
  - [x] Add cookie-based auth endpoints (`/auth/*`) with refresh rotation + CSRF middleware
  - [x] Protect `/rspc` procedures with access-JWT cookie (allowlist ping/health)

### Phase 4 - Web UI (SolidJS)
- [x] Scaffold SolidJS + Tailwind v4 (Vite)
- [x] Login + dashboard + node list
  - [x] Login UI + session chip + modal
  - [x] Auto-refresh access token on rspc 401 (single retry) + auth-expired UX
  - [x] Instance manager (create/list/start/stop/delete)
  - [x] File explorer (fs.listDir/fs.readFile)
  - [x] Log viewer (log.tailFile)
  - [x] Instance -> Files shortcuts (open instance dir / latest.log)

### Phase 4.1 - Web UX / UI Revamp (no feature regressions)
Definition of Done (must be true):
- No behavior regressions: login/session, instances, files, logs, nodes all work
- App is split into pages/components (no 1k+ LOC single file)
- Minimal/no manual Refresh buttons; data stays correct via auto-refetch + invalidation
- Visual polish: consistent spacing/typography/colors, better first impression (top-left nav/header)

TODO:
- [x] Refactor structure: split `web/src/App.tsx` into Layout + pages + shared UI components
- [x] Remove redundant Refresh buttons; switch to rspc query invalidation on mutations
- [x] Improve loading/empty/error states (skeletons, inline errors, disable states)
- [x] Polish UI primitives: buttons/inputs/dropdowns/modals consistency
  - [x] End-to-end verification: `npm run build` (and keep rspc bindings unchanged)

### Phase 4.2 - Web UI/UX Overhaul (aesthetic + interaction quality)
Definition of Done (must be true):
- Instances list no longer looks like long, flat “rows”; uses responsive cards/grid and clear hierarchy
- Game version selection is real-time and not hard-coded:
  - Minecraft versions come from Mojang piston-meta manifest (cached)
  - UI does not require manual version typing for common flows
- Richer palette + typography: display font for headings, keep code font, consistent tokens
- Microinteractions everywhere: hover/active/focus/disabled states feel “clicky” and intentional

TODO:
- [x] Redesign Instances list: responsive card/grid layout + better action grouping
- [x] Add control-plane rspc `minecraft.versions` (cached via ETag/Last-Modified) and wire UI dropdown (no manual entry)
- [x] Decide Terraria versions strategy (if no official list endpoint: curated list + advanced override) and wire UI
- [x] Color + typography refresh (add display font for headings; keep IBM Plex Mono for code)
- [x] Microinteractions pass (buttons, cards, nav, dropdown, loading states)
- [x] Verify: `npm run build`, rspc bindings unchanged, `cargo fmt/clippy/test`

### Phase 4.3 - Instance UX + Multi-instance ergonomics
Definition of Done (must be true):
- Creating an instance feels “product-grade”: name, presets, sensible defaults
- Ports: user can leave port blank and the system assigns an available port automatically
- Multiple instances can run concurrently without port conflicts (compose dev supports this)
- Memory selection uses presets (2G/4G/8G/16G) with optional custom override
- Account/Admin chip in top-right is elegant and consistent with the new design

TODO:
- [x] Instance naming: allow user-provided display name; show it in instances list
- [x] Auto port assignment in agent for Minecraft/Terraria when port is omitted
- [x] Memory presets dropdown for Minecraft (2G/4G/8G/16G + custom)
- [x] Docker compose: run alloy-agent in host network mode (dev) and adjust control->agent endpoint
- [x] Redesign account/admin chip (top-right)
- [x] Verify: web build, rspc bindings clean, cargo fmt/clippy/test

### Phase 5 - Game plugins
- [ ] Minecraft adapter (parity with legacy core features)
- [x] Terraria adapter (prove multi-game extensibility)

### Phase 5.1 - Public access (FRP)
Definition of Done (must be true):
- Instances can optionally expose `host:port` via FRP even when nodes have no public IP
- UI supports pasting FRP client config and shows copyable public endpoint

TODO:
- [ ] Add FRP client sidecar (frpc) per instance (custom pasted config)
- [ ] Optional: manage FRP servers (frps) from the panel

### Phase 5.2 - Worlds / saves
TODO:
- [ ] World/saves import & replace (Minecraft + Terraria)
- [ ] Backup + restore flow (download/upload or URL import)

### Phase 5.3 - Minecraft modpacks
TODO:
- [ ] Modpack server template (upload server pack zip)
- [ ] Modpack download + deploy from mainstream sites (start with Modrinth)

### Phase 5.4 - Don't Starve Together
TODO:
- [ ] Add DST dedicated server template + docs (SteamCMD-based)

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

---

## Milestone 2 - Terraria Vanilla (real)
Definition of Done (must be true):
- Agent exposes a template `terraria:vanilla` (no arbitrary cmd from web/control)
- Agent downloads Terraria dedicated server for Linux, verifies checksum (if available), and caches it under a persistent data root
- Agent creates an instance dir under `ALLOY_DATA_ROOT`, writes `serverconfig.txt`, and places/creates a world file under the instance
- Start/stop works end-to-end from web UI, logs are visible via tail, and stop is graceful (stdin `exit\n`) with TERM/KILL fallback
- Docker compose mounts persistent `/data` for agent (instance+cache) and publishes port `7777`

Defaults (recorded):
- Port: 7777 (configurable in params)
- Max players: 8 (configurable in params)
- World: auto-create if missing (configurable: name/size)
- Password: optional

TODO:
- [x] Add `terraria:vanilla` template and param validation in agent
- [x] Implement Terraria server package resolve + download/cache (+ checksum verify if available)
- [x] Create instance layout under `ALLOY_DATA_ROOT` (world dir + `serverconfig.txt` + log file target)
- [x] Start server from instance dir via `./TerrariaServer.bin.x86_64 -config serverconfig.txt` (or equivalent)
- [x] Stop via stdin `exit\n` then TERM/KILL fallback
- [x] Update Docker agent image/runtime prerequisites if needed and mount `/data`
- [x] Update web UI: add terraria start form (version/port/max_players/world/password)
- [x] Verify end-to-end in docker-compose and check off this section
