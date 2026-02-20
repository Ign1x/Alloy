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
  - Minimal adapter template model for lightweight game definitions.
- `crates/alloy-agent/src/templates.rs`
  - Bridges lightweight adapter template into existing process template list.

## How To Add A New Game (Lightweight Path)

1. Add a lightweight template in `game_adapter_template.rs`.
2. Add port policy in `game_adapters.rs` if auto-port persistence is needed.
3. If required, add runtime-specific layout/download/start logic in existing game module path.
4. Keep shared validation and safety checks in platform modules, not in per-game forks.

## Safety Baseline

- Instance id normalization and path traversal protections remain in `instance_service`.
- Auto-port assignment uses protocol-aware allocation and intra-template dedup.
- Existing process lifecycle safeguards remain in `process_manager`.

## Why This Helps A Single Maintainer

- Platform code handles repeated concerns once.
- Adapters are mostly data/policy, so new game onboarding is smaller.
- Fewer hardcoded branches in instance-level persistence logic.
