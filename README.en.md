# Alloy

> A control plane for self-hosted game servers: `Web + Control + Agent`.

Alloy provides a unified panel for managing instances, nodes, and updates across single-host and multi-node setups.

---

## Architecture

```text
Web (SolidJS)
   │
   ▼
alloy-control (Axum + rspc)
   │
   └─ /agent/ws (reverse connection)
   ▼
alloy-agent (download / lifecycle / files / logs / updates)
```

---

## Quick Start (Image Deployment)

### 1) Requirements

- Docker
- Docker Compose

### 2) One-command install (release only)

```bash
curl -fsSL https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy/install.sh | bash -s -- --mode release
```

The installer auto-generates:

- `.env` (missing keys are auto-filled, including random secrets)
- `docker-compose.generated.release.yml`

### 3) Access

- Panel: `http://127.0.0.1:10043`
- Control ping: `http://127.0.0.1:10043/rspc/control.ping?input=null`
- First-login default (when missing in `.env`): `admin / admin123456`

To run game instances, deploy `alloy-agent` on node hosts separately and connect them via panel `Nodes`.

---

## Updates

Upgrade to latest images:

```bash
curl -fsSL https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy/install.sh | bash -s -- --mode release
```

Pin a specific version:

```bash
curl -fsSL https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy/install.sh | ALLOY_IMAGE_TAG=v0.2.14 bash -s -- --mode release
```

---

## Data Persistence

By default, data is stored in Docker volumes bound to the current directory:

- `./alloy-postgres`

Stop containers and keep data:

```bash
docker compose --env-file .env -f docker-compose.generated.release.yml down
```

Stop containers and remove persisted data directories:

```bash
docker compose --env-file .env -f docker-compose.generated.release.yml down
rm -rf alloy-postgres
```

If you want to pre-create directories (to avoid first-run permission surprises):

```bash
mkdir -p alloy-postgres
```

---

## Repository Layout

```text
crates/
  alloy-agent/
  alloy-control/
  alloy-db/
  alloy-migration/
  alloy-proto/
web/
deploy/
```

---

## Docs

- Deployment details: `deploy/README.md`
- Workflow: `WORKFLOW.md`
