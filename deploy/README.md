# Deployment (Docker)

This directory contains the Dockerized deployment for the current vertical slice
(web -> rspc -> alloy-control -> alloy-agent).

Alloy supports two agent transport modes:
- **Direct gRPC**: control dials `ALLOY_AGENT_ENDPOINT` (works when the agent is reachable inbound).
- **Reverse tunnel (recommended)**: agent dials back to control over WebSocket (`ALLOY_CONTROL_WS_URL`), so it works behind NAT / without a public IP.

## Services
- `alloy-agent` (gRPC): container port `50051`
- `alloy-agent` (Game servers): bind directly on the host (host networking)
- `alloy-control` (HTTP): container port `8080` (serves `/healthz` and `/rspc`)
- `web` (nginx): container port `80` (serves SPA + proxies `/rspc` to control)

Default host ports (via compose):
- web: `http://localhost:3000`
- control: `http://localhost:8080`
- games: depends on instance `port` (e.g. Minecraft `25565`, Terraria `7777`)

## Quick start

Build and start:

```bash
docker compose up -d --build
```

## Updates

Alloy stores persistent data in Docker volumes (not the container filesystem), so updating containers does **not** wipe worlds/configs as long as you keep the same volumes.

### Source build (this repo)

Pull latest code and rebuild:

```bash
git pull
docker compose up -d --build
```

### Release images (recommended)

Use the prebuilt image-based compose file:

```bash
docker compose -f deploy/docker-compose.release.yml pull
docker compose -f deploy/docker-compose.release.yml up -d
```

By default, release compose pulls from GHCR (`ghcr.io/ign1x`).
You can switch to another registry namespace (for example DockerHub mirror) without editing YAML:

```bash
export ALLOY_IMAGE_REPO_PREFIX=docker.io/<your-namespace>
export ALLOY_IMAGE_TAG=latest
docker compose -f deploy/docker-compose.release.yml pull
docker compose -f deploy/docker-compose.release.yml up -d
```

### One-click updates (optional)

`deploy/docker-compose.release.yml` includes a `watchtower` service with an HTTP API and a default manifest URL:

- `https://github.com/Ign1x/Alloy/releases/latest/download/update-manifest.json`

This manifest asset is published together with each tag release by CI.
If you set `ALLOY_WATCHTOWER_TOKEN` (compose `.env`) and keep the panel admin-only, you can trigger control updates from the UI:

- Web → **Settings** → **Updates** → **Update now**

Stop (keep data):

```bash
docker compose down
```

Reset (⚠️ wipes `alloy-agent` `/data` + Postgres volume):

```bash
docker compose down -v
```

## Persistent data (`/data`)

The agent stores **everything** under `ALLOY_DATA_ROOT` (default: `/data` in the Docker image):
- `instances/<instance_id>/` (worlds/config/logs for each instance)
- `cache/` (downloaded Minecraft jars / Terraria zips + extracted server roots)
- `logs/agent.log*` (agent tracing logs)

In `docker-compose.yml`, `/data` is backed by the `alloy-agent-data` volume, so it **persists across container restarts/upgrades**.

Important:
- `docker compose down -v` deletes volumes, including `alloy-agent-data`, and will permanently remove worlds/instances/cache.
- For explicit persistence/backups, bind-mount a host directory instead of a named volume, e.g.:

```yaml
services:
  alloy-agent:
    volumes:
      - ./alloy-data:/data
```

## Instance isolation (sandbox)

Alloy now supports per-instance sandboxing with resource limits:

- **One instance = one isolated runtime** (preferred: per-instance `docker run` container; fallback: `bwrap`/native)
- **Resource limits** (memory / cpu / pids / open files)
- **Least privilege defaults** (`no-new-privileges`, `cap-drop=ALL`, read-only rootfs, bounded FD/process counts)

Global defaults (agent env):

- `ALLOY_SANDBOX_DEFAULT_ENABLED=true`
- `ALLOY_SANDBOX_MODE=auto` (`auto|docker|bwrap|native|off`)
- `ALLOY_SANDBOX_DOCKER_ENABLED=true`
- `ALLOY_SANDBOX_FORCE_MODE=docker` (recommended: fail fast instead of silently falling back)
- `ALLOY_SANDBOX_DOCKER_DATA_VOLUME=alloy-agent-data` (for compose named-volume `/data`)
- `ALLOY_SANDBOX_DOCKER_IMAGE=ghcr.io/ign1x/alloy-agent:latest` (required for docker sandbox; in local `docker-compose.yml` use `alloy-agent-local:latest`)
- `ALLOY_SANDBOX_ENABLE_CGROUPS=true`
- `ALLOY_SANDBOX_MEMORY_MB_DEFAULT=4096`
- `ALLOY_SANDBOX_PIDS_LIMIT_DEFAULT=512`
- `ALLOY_SANDBOX_NOFILE_LIMIT_DEFAULT=8192`
- `ALLOY_SANDBOX_CPU_MILLICORES_DEFAULT=2000`

Per-instance advanced params (in template start payload):

- `sandbox_enabled` (`true|false`)
- `sandbox_mode` (`auto|docker|bwrap|native|off`)
- `sandbox_memory_mb` (0 to disable limit)
- `sandbox_pids_limit` (0 to disable limit)
- `sandbox_nofile_limit` (0 to disable limit)
- `sandbox_cpu_millicores` (0 to disable cgroup cpu quota)

Notes:

- Docker mode needs the Docker socket mounted into `alloy-agent` (`/var/run/docker.sock`).
- Mounting Docker socket is a trust boundary tradeoff: treat `alloy-agent` as privileged on that host.
- `bwrap` is optional. In `ALLOY_SANDBOX_MODE=auto`, agent falls back to `bwrap` or native when Docker mode is unavailable.
- Cgroup enforcement is best-effort and depends on host cgroup v2 permissions.
- Current networking model is still host-network based for game ports; sandbox focuses on process/resource isolation first.

## Verification

Control health:

```bash
curl -fsS http://localhost:8080/healthz
```

rspc endpoints:

```bash
curl -fsS "http://localhost:8080/rspc/control.ping?input=null"
curl -fsS "http://localhost:8080/rspc/agent.health?input=null"
curl -fsS "http://localhost:8080/rspc/process.templates?input=null"
```

## Minecraft (vanilla)

Milestone 1 template id: `minecraft:vanilla`

Required params:
- `accept_eula=true` (agent refuses otherwise)

Optional params:
- `version` (default: `latest_release`)
- `memory_mb` (default: 2048)
- `port` (default: 25565)

Start (rspc):

```bash
curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"template_id":"minecraft:vanilla","params":{"accept_eula":"true","version":"latest_release","memory_mb":"2048","port":"25565"}}' \
  http://localhost:8080/rspc/process.start
```

Note: The agent will download the server jar from Mojang (piston-meta), verify sha1, cache it under `/data`, and run it with Java 21.

Web (same-origin `/rspc`):

```bash
curl -fsS http://localhost:3000/ > /dev/null
curl -fsS "http://localhost:3000/rspc/control.ping?input=null"
```

## Terraria (vanilla)

Milestone 2 template id: `terraria:vanilla`

Optional params:
- `version` (default: 1453)
- `port` (default: 7777)
- `max_players` (default: 8)
- `world_name` (default: world)
- `world_size` (default: 1)
- `password` (optional)

### Terraria version notes

`version` is the **package id** used by Alloy's downloader (not a dotted semver string).
Examples:
- `1453` = Terraria `1.4.5.3`
- `1452` = Terraria `1.4.5.2`
- `1449` = Terraria `1.4.4.9`

If you know a valid package id, you can use the UI “ADV” switch to type it directly.

Start (rspc):

```bash
curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"template_id":"terraria:vanilla","params":{"version":"1453","port":"7777","max_players":"8","world_name":"world","world_size":"1"}}' \
  http://localhost:8080/rspc/process.start
```

## Palworld (vanilla)

Milestone 3 template id: `palworld:vanilla`

Optional params:
- `server_name` (default: `Alloy Palworld server`)
- `server_description` (default: empty)
- `max_players` (default: `32`)
- `port` (default: `8211`, `0` means auto)
- `query_port` (default: `27015`, `0` means auto)
- `password` (optional)
- `admin_password` (optional)
- `public` (`false` by default)

Start (rspc):

```bash
curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"template_id":"palworld:vanilla","params":{"server_name":"Alloy Palworld server","max_players":"32","port":"8211","query_port":"27015","public":"false"}}' \
  http://localhost:8080/rspc/process.start
```

## Factorio (vanilla)

Milestone 4 template id: `factorio:vanilla`

Optional params:
- `version` (default: `stable`, also supports `experimental`)
- `server_name` (default: `Alloy Factorio server`)
- `server_description` (default: empty)
- `max_players` (default: `8`)
- `port` (default: `34197`, `0` means auto)
- `public` (`false` by default)
- `rcon_enabled` (`false` by default)
- `rcon_port` (default: `27015`, `0` means auto)
- `rcon_password` (required when `rcon_enabled=true`)

Start (rspc):

```bash
curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"template_id":"factorio:vanilla","params":{"version":"stable","server_name":"Alloy Factorio server","max_players":"8","port":"34197","public":"false"}}' \
  http://localhost:8080/rspc/process.start
```

## Troubleshooting (common)

| What you see | Likely cause | Fix |
| --- | --- | --- |
| `download_failed` | No network / upstream blocked | Check DNS + outbound HTTPS connectivity, then retry. |
| `java_major_mismatch` | Minecraft requires Java X but runtime has Y | Install the required Java (Temurin recommended) or use the provided `alloy-agent` Docker image. |
| `insufficient_disk` | Low free space under `ALLOY_DATA_ROOT` | Free disk space or mount a larger volume for `/data`. |
| `spawn_failed` | Missing deps / non-executable server binary | Use Docker image (recommended) or install runtime deps (see `deploy/agent.Dockerfile`: `libicu`, `libssl`, `zlib`, etc). |
| `read_only` | Control is in read-only mode | Unset `ALLOY_READ_ONLY` and restart `alloy-control`. |
| FS write operations unavailable | FS write is disabled by default | Set `ALLOY_FS_WRITE_ENABLED=true` on `alloy-agent` (still scoped to `ALLOY_DATA_ROOT`). |

## Configuration

`alloy-control` uses `ALLOY_AGENT_ENDPOINT` for **direct gRPC** and `ALLOY_AGENT_TRANSPORT` to pick the transport:

- `ALLOY_AGENT_TRANSPORT=auto` (default): use reverse tunnel if connected, otherwise use direct gRPC.
- `ALLOY_AGENT_TRANSPORT=tunnel`: only use reverse tunnel.
- `ALLOY_AGENT_TRANSPORT=direct`: only use direct gRPC.

- Local dev default: `http://127.0.0.1:50051`
- docker-compose (host-networked agent): `http://host.docker.internal:50051` (via `extra_hosts: host-gateway`)

To enable **reverse tunnel** (agent -> control), set on `alloy-agent`:
- `ALLOY_CONTROL_WS_URL=http://<control-host>:8080/agent/ws`
- `ALLOY_NODE_NAME=<node-name>` (optional; defaults to `$ALLOY_NODE_NAME` or `$HOSTNAME`)
- `ALLOY_NODE_TOKEN=<token>` (optional; required if the node is created via the Nodes UI)

For panel one-click updates, set on `alloy-control`:

- `ALLOY_UPDATE_WATCHTOWER_URL=http://watchtower:8080` (required)
- `ALLOY_UPDATE_WATCHTOWER_TOKEN=<token>` (optional; required only when watchtower HTTP API auth is enabled)
- `ALLOY_UPDATE_MANIFEST_URL=<json-url>` (optional; defaults to `https://github.com/Ign1x/Alloy/releases/latest/download/update-manifest.json`)

The default manifest URL is release-asset based (not branch-file based), so update checks stay stable even if the default branch name changes.
A sample manifest is also kept at `deploy/update-manifest.json`.

For release compose image sources:

- `ALLOY_IMAGE_REPO_PREFIX=ghcr.io/ign1x` (default)
- `ALLOY_IMAGE_REPO_PREFIX=docker.io/<your-namespace>` (DockerHub mirror)
- `ALLOY_IMAGE_TAG=latest` (default; can pin to `v0.x.y` if desired)

### Automated release publishing (GHCR primary + DockerHub mirror)

CI workflow: `.github/workflows/publish-containers.yml`

Trigger modes:

- Push tag `v*` (for example `v0.2.3`)
- Manual run (`workflow_dispatch`) with `tag`

What CI does:

1. Build/push `alloy-agent`, `alloy-control`, `alloy-web` to GHCR
2. Optionally mirror the same tags to DockerHub (if secrets are configured)
3. Generate `update-manifest.json` for that tag
4. Upload manifest as release asset, so `releases/latest/download/update-manifest.json` always points to the newest published release

Required repo secrets for DockerHub mirror:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `DOCKERHUB_NAMESPACE` (optional; defaults to `DOCKERHUB_USERNAME`)

### Remote node self-update (from Control Web)

You can trigger updates for a remote node's `alloy-agent` from **Nodes** in the panel.

On each remote node, run a local Watchtower sidecar and configure agent env:

- `ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_URL=http://watchtower:8080`
- `ALLOY_AGENT_SELF_UPDATE_WATCHTOWER_TOKEN=<node-local-token>`

And on the node-local Watchtower container:

- `WATCHTOWER_HTTP_API_UPDATE=true`
- `WATCHTOWER_HTTP_API_TOKEN=<same node-local-token>`
- `WATCHTOWER_LABEL_ENABLE=true`

Also label the remote `alloy-agent` container:

- `com.centurylinklabs.watchtower.enable=true`

Notes:

- This updates the **selected node only**, not control/web.
- The connection path is `control -> agent tunnel -> node-local watchtower`.
- After update, the node briefly disconnects and auto-reconnects.
