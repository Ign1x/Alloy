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

### 2) Download the compose file

Using `curl`:

```bash
curl -fsSL https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy/docker-compose.release.yml -o docker-compose.yml
```

Or with `wget`:

```bash
wget -O docker-compose.yml https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy/docker-compose.release.yml
```

### 3) Create `.env`

Create `.env` in the current directory (minimum variables):

```env
ALLOY_JWT_SECRET=use-a-strong-random-string

# Optional for first boot
ALLOY_ADMIN_USER=admin
ALLOY_ADMIN_PASS=set-admin-password

# Optional: watchtower HTTP API token
ALLOY_WATCHTOWER_TOKEN=
```

### 4) Start

```bash
docker compose pull
docker compose up -d
```

### 5) Access

- Panel: `http://127.0.0.1:10043`
- Control ping: `http://127.0.0.1:10043/rspc/control.ping?input=null`

---

## Updates

Upgrade to latest images:

```bash
docker compose pull
docker compose up -d
```

Pin a specific version:

```bash
ALLOY_IMAGE_TAG=v0.2.6 docker compose up -d
```

---

## Data Persistence

By default, data is stored in Docker volumes bound to the current directory:

- `./alloy-agent-data`
- `./alloy-postgres`

Stop containers and keep data:

```bash
docker compose down
```

Stop containers and remove persisted data directories:

```bash
docker compose down
rm -rf alloy-agent-data alloy-postgres
```

If you want to pre-create directories (to avoid first-run permission surprises):

```bash
mkdir -p alloy-agent-data alloy-postgres
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
