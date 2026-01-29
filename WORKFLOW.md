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
- [ ] Add Rust Dockerfiles: `deploy/agent.Dockerfile`, `deploy/control.Dockerfile`
- [ ] Add web Dockerfile + nginx config proxying `/rspc` -> control
- [ ] Add `deploy/docker-compose.yml` to run `web` + `alloy-control` + `alloy-agent`
- [ ] Verify end-to-end via compose and check off this section

### Phase 1 - Core domain + multi-game abstraction
- [ ] Define `GameAdapter` traits (start/stop/install/config/ports)
- [ ] Define `ProcessSupervisor` + sandbox boundaries

### Phase 2 - Agent (gRPC)
- [ ] Define gRPC protos: health, instance lifecycle, logs, filesystem APIs
  - [x] Create `alloy-proto` codegen crate (build.rs + proto files)
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

### Phase 5 - Game plugins
- [ ] Minecraft adapter (parity with legacy core features)
- [ ] Terraria adapter (prove multi-game extensibility)
