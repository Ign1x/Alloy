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

### Phase 0 - Bootstrap
- [x] Wipe legacy code and reset repo (keep git history)
- [x] Create `WORKFLOW.md`
- [ ] Confirm the rspc+gRPC boundary is acceptable (no gRPC in browsers; rspc provides TS types)
- [x] Initialize Rust workspace skeleton (crates + basic build)
- [x] Add basic formatting/lint (rustfmt, clippy) and CI
  - [x] Add `.editorconfig`
  - [x] Add GitHub Actions CI (fmt, clippy, test)

### Phase 1 - Core domain + multi-game abstraction
- [ ] Define `GameAdapter` traits (start/stop/install/config/ports)
- [ ] Define `ProcessSupervisor` + sandbox boundaries

### Phase 2 - Agent (gRPC)
- [ ] Define gRPC protos: health, instance lifecycle, logs, filesystem APIs
  - [x] Create `alloy-proto` codegen crate (build.rs + proto files)
- [ ] Implement `alloy-agent` gRPC server skeleton

### Phase 3 - Control plane (Axum + rspc + DB)
- [ ] DB schema design (SeaORM): users, nodes, instances, games, tokens
- [ ] Auth/session model (cookie/JWT) and security policy
- [ ] rspc router skeleton + TS bindings generation strategy

### Phase 4 - Web UI (SolidJS)
- [ ] Scaffold SolidJS + Tailwind v4 (Vite)
- [ ] Login + dashboard + node list

### Phase 5 - Game plugins
- [ ] Minecraft adapter (parity with legacy core features)
- [ ] Terraria adapter (prove multi-game extensibility)
