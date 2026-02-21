# Game Platform + Lightweight Adapter

This project now supports a single-maintainer workflow based on one platform and lightweight adapters.

## Goal

- Keep one stable platform path for instance lifecycle and safety checks.
- Add new games with minimal adapter data instead of copy-paste service branches.
- Reduce maintenance cost and avoid per-game drift.

## Current Platform Surface

- `crates/alloy-agent/src/instance_service.rs`
  - `ensure_persisted_ports` now uses one adapter-based allocator.
- `crates/alloy-agent/src/game_adapters.rs`
  - Shared adapter manifest table for per-template port policy.
  - One generic `ensure_adapter_ports` path for auto-assigned ports.
- `crates/alloy-agent/src/game_adapter_template.rs`
  - Canonical adapter registry (`list_adapter_templates`) that defines:
    - parameter schema (key/label/type/default/help/required/advanced),
    - validator binding per template,
    - port policy declaration (protocol + field list),
    - startup command/args and graceful stdin.
- `crates/alloy-agent/src/templates.rs`
  - Converts adapter schema into RPC `TemplateParam` and appends shared sandbox params.
  - Uses adapter-level validation dispatch for all adapter templates.

## How To Add A New Game (Lightweight Path)

1. Implement game runtime logic (if needed) in its existing module (for example `foo.rs`) and expose `validate_vanilla_params` (or equivalent validator).
2. Register one `AdapterTemplate` entry in `game_adapter_template.rs`:
   - set `template_id`, `display_name`, `startup_command`, `startup_args`,
   - define `params` with `TemplateParamKind` and full UX metadata,
   - set `validator` and `ports`,
   - set `graceful_stdin` when graceful shutdown is supported.
3. Do not add template wiring in `templates.rs` or port mapping in `game_adapters.rs`; both consume the adapter registry automatically.
4. Keep shared validation/safety checks centralized in platform modules instead of per-game forks.
5. Run `cargo test -p alloy-agent` and ensure adapter template contract tests pass.

## Port Policy Rules

- Declare all auto-allocated ports in `AdapterTemplate.ports`.
- Use `PortProtocol::Tcp` / `PortProtocol::Udp` per field.
- Use `0` or empty values to trigger auto-allocation; explicit non-zero values are preserved.
- Multi-port templates are deduplicated within the same protocol during allocation.
- If a game has both UDP and TCP ports (for example Factorio game port + RCON TCP port), declare both fields in `AdapterTemplate.ports` so they are auto-assigned and persisted consistently.

## Parameter Schema Rules

- Define every user-facing field in `AdapterTemplateParam` (no ad-hoc params in `templates.rs`).
- Choose `TemplateParamKind` exactly:
  - `String` for plain text,
  - `Int { min, max }` for bounded integers,
  - `Bool` for true/false,
  - `SecretString` for sensitive values.
- Keep defaults, placeholders, enum values, and help text in the same schema entry.
- `required=true` enforces non-empty presence; domain-specific checks belong in validator functions.

## Safety Baseline

- Instance id normalization and path traversal protections remain in `instance_service`.
- Auto-port assignment uses protocol-aware allocation and intra-template dedup.
- Existing process lifecycle safeguards remain in `process_manager`.

## Why This Helps A Single Maintainer

- Platform code handles repeated concerns once.
- Adapters are mostly data/policy, so new game onboarding is smaller.
- Fewer hardcoded branches in instance-level persistence logic.
