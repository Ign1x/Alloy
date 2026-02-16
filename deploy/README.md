# Deployment (Docker)

This directory contains the Dockerized deployment for the current vertical slice
(web -> rspc -> alloy-control).

Alloy supports two agent transport modes:
- **Direct gRPC**: control dials `ALLOY_AGENT_ENDPOINT` (works when the agent is reachable inbound).
- **Reverse tunnel**: agent dials back to control over WebSocket (`ALLOY_CONTROL_WS_URL`), so it works behind NAT / without a public IP.

## Services
- `alloy-control` (HTTP): container port `8080` (serves `/healthz` and `/rspc`)
- `web` (nginx): container port `80` (serves SPA + proxies `/rspc` to control)

Note: `deploy/docker-compose.release.yml` is control-plane only and does not include a local `alloy-agent` service.

Default host ports (via compose):
- release compose entrypoint (web + API): `http://localhost:10043`
- local compose web: `http://localhost:3000`

## Quick start

Local mode (source build):

```bash
bash deploy/install.sh --mode local
```

Release mode (prebuilt images):

```bash
bash deploy/install.sh --mode release
```

Windows PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\install.ps1 -Mode local
powershell -ExecutionPolicy Bypass -File .\deploy\install.ps1 -Mode release
```

Default first-login credential (if `.env` is empty): `admin / admin123456`.

Installer scripts also re-load values from `.env` into process env before running Docker Compose,
so accidentally exported empty shell vars will not break startup.

## Updates

Alloy stores persistent data outside the container filesystem, so updating containers does **not** wipe worlds/configs as long as you keep the same mounts/volumes.

For `deploy/docker-compose.release.yml`, Postgres data uses a named volume with local bind backing (`driver_opts`), so control-plane data is visible in the compose directory.

### Generated compose files

Installer scripts generate and use:

- local: `deploy/docker-compose.generated.local.yml`
- release: `deploy/docker-compose.generated.release.yml`

Templates kept in repo:

- `deploy/docker-compose.local.yml`
- `deploy/docker-compose.release.yml`

To only generate files (without starting containers):

```bash
bash deploy/install.sh --mode local --no-up
bash deploy/install.sh --mode release --no-up
```

By default, release mode pulls from GHCR (`ghcr.io/ign1x`). You can switch registry namespace without editing YAML:

```bash
export ALLOY_IMAGE_REPO_PREFIX=docker.io/<your-namespace>
export ALLOY_IMAGE_TAG=latest
bash deploy/install.sh --mode release
```

Release compose is **control-plane only** (`web + alloy-control + postgres + watchtower`) and does not start a local `alloy-agent`.
For game nodes, deploy `alloy-agent` on remote hosts and connect them from panel `Nodes`.

### One-click updates (optional)

`deploy/docker-compose.release.yml` (generated to `deploy/docker-compose.generated.release.yml`) includes a `watchtower` service with an HTTP API and a default manifest URL:

- `https://github.com/Ign1x/Alloy/releases/latest/download/update-manifest.json`

This manifest asset is published together with each tag release by CI.
If you set `ALLOY_WATCHTOWER_TOKEN` (compose `.env`) and keep the panel admin-only, you can trigger control updates from the UI:

- Web → **Settings** → **Updates** → **Update now**

Stop (keep data):

```bash
docker compose --env-file .env -f deploy/docker-compose.generated.release.yml down
```

Reset release data (⚠️ wipes `./alloy-postgres`):

```bash
docker compose --env-file .env -f deploy/docker-compose.generated.release.yml down
rm -rf alloy-postgres
```

For local mode volumes, use:

```bash
docker compose --env-file .env -f deploy/docker-compose.generated.local.yml down -v
```

## Persistent data (release compose)

`deploy/docker-compose.release.yml` persists control-plane Postgres data via:

- `alloy-postgres` volume bind-backed to `./alloy-postgres`

Important:
- `docker compose down -v` removes named volumes, but bind-backed host data may still exist depending on Docker behavior and filesystem permissions.
- If you run `alloy-agent` on remote hosts, their game data is persisted on those hosts under that node's own `ALLOY_DATA_ROOT`.

## Instance isolation (sandbox)

Alloy now supports per-instance sandboxing with resource limits:

- **One instance = one isolated runtime** (preferred: per-instance `docker run` container; fallback: `bwrap`/native)
- **Resource limits** (memory / cpu / pids / open files)

Global defaults (agent env):

- `ALLOY_SANDBOX_DEFAULT_ENABLED=true`
- `ALLOY_SANDBOX_MODE=auto` (`auto|docker|bwrap|native|off`)
- `ALLOY_SANDBOX_DOCKER_ENABLED=true`
- `ALLOY_SANDBOX_FORCE_MODE=docker` (fail if docker sandbox is unavailable)
- `ALLOY_SANDBOX_DOCKER_IMAGE=ghcr.io/ign1x/alloy-agent:latest` (required for docker sandbox on remote nodes)
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

Release entrypoint check (single port):

```bash
curl -fsS http://localhost:10043/ > /dev/null
```

rspc endpoints (`agent.*` calls require at least one connected node):

```bash
curl -fsS "http://localhost:10043/rspc/control.ping?input=null"
curl -fsS "http://localhost:10043/rspc/agent.health?input=null"
curl -fsS "http://localhost:10043/rspc/process.templates?input=null"
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
  http://localhost:10043/rspc/process.start
```

Note: The agent will download the server jar from Mojang (piston-meta), verify sha1, cache it under `/data`, and run it with Java 21.

Web (same-origin `/rspc`, release compose):

```bash
curl -fsS http://localhost:10043/ > /dev/null
curl -fsS "http://localhost:10043/rspc/control.ping?input=null"
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
  http://localhost:10043/rspc/process.start
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
  http://localhost:10043/rspc/process.start
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
  http://localhost:10043/rspc/process.start
```

## Troubleshooting (common)

| What you see | Likely cause | Fix |
| --- | --- | --- |
| `download_failed` | No network / upstream blocked | Check DNS + outbound HTTPS connectivity, then retry. |
| `java_major_mismatch` | Minecraft requires Java X but runtime has Y | Install the required Java (Temurin) or use the provided `alloy-agent` Docker image. |
| `insufficient_disk` | Low free space under `ALLOY_DATA_ROOT` | Free disk space or mount a larger volume for `/data`. |
| `spawn_failed` | Missing deps / non-executable server binary | Use Docker image or install runtime deps (see `deploy/agent.Dockerfile`: `libicu`, `libssl`, `zlib`, etc). |
| `read_only` | Control is in read-only mode | Unset `ALLOY_READ_ONLY` and restart `alloy-control`. |
| FS write operations unavailable | FS write is disabled by default | Set `ALLOY_FS_WRITE_ENABLED=true` on `alloy-agent` (still scoped to `ALLOY_DATA_ROOT`). |

## Configuration

`alloy-control` uses `ALLOY_AGENT_ENDPOINT` for **direct gRPC** and `ALLOY_AGENT_TRANSPORT` to pick the transport:

- `ALLOY_AGENT_TRANSPORT=auto` (default): use reverse tunnel if connected, otherwise use direct gRPC.
- `ALLOY_AGENT_TRANSPORT=tunnel`: only use reverse tunnel.
- `ALLOY_AGENT_TRANSPORT=direct`: only use direct gRPC.

In `deploy/docker-compose.release.yml`, we set `ALLOY_AGENT_TRANSPORT=tunnel` by default (control-plane only, no local direct agent endpoint).

- Local dev default: `http://127.0.0.1:50051`
- docker-compose (host-networked agent): `http://host.docker.internal:50051` (via `extra_hosts: host-gateway`)

To enable **reverse tunnel** (agent -> control) on a remote `alloy-agent` host, set:
- `ALLOY_CONTROL_WS_URL=http://<control-host>:10043/agent/ws`
- `ALLOY_CONTROL_WS_URLS=wss://<primary>/agent/ws,wss://<backup>/agent/ws` (optional; comma/space separated failover list, first URL is preferred)
- `ALLOY_NODE_NAME=<node-name>` (optional; defaults to `$ALLOY_NODE_NAME` or `$HOSTNAME`)
- `ALLOY_NODE_TOKEN=<token>` (required when node access is token-protected)
- `ALLOY_CONTROL_WS_PING_INTERVAL_MS=10000` (optional, set on `alloy-agent`; tunnel heartbeat interval, clamp range `1000..120000`)
- `ALLOY_CONTROL_WS_APP_KEEPALIVE_MS=15000` (optional, set on `alloy-agent`; app-level text keepalive, survives some proxies/CDNs that ignore WS Ping; set `0` to disable)
- `ALLOY_CONTROL_WS_CONNECT_TIMEOUT_MS=15000` (optional, set on `alloy-agent`; handshake timeout, clamp range `1000..300000`)
- `ALLOY_CONTROL_WS_IDLE_TIMEOUT_MS=60000` (optional, set on `alloy-agent`; default is disabled when unset/`0`; if enabled, clamp range `5000..900000` and auto-adjusted to at least `3 * ping interval`)
- `ALLOY_CONTROL_WS_RECONNECT_BASE_MS=500` (optional, set on `alloy-agent`; reconnect base delay, clamp range `100..10000`)
- `ALLOY_CONTROL_WS_RECONNECT_MAX_MS=8000` (optional, set on `alloy-agent`; reconnect max delay, clamp range `500..120000`)
- `ALLOY_AGENT_WS_PING_INTERVAL_MS=10000` (optional, set on `alloy-control`; server-side Ping keepalive interval, clamp range `1000..120000`)
- `ALLOY_AGENT_WS_APP_KEEPALIVE_MS=15000` (optional, set on `alloy-control`; server-side app keepalive, set `0` to disable)
- `ALLOY_TUNNEL_DISCONNECT_GRACE_MS=90000` (optional, set on `alloy-control`; suppress transient "no active tunnel" errors shortly after reconnect flaps)

For panel `Nodes -> Add node` default URL, set on `alloy-control` (optional):
- `ALLOY_CONTROL_WS_URL_DEFAULT=https://<public-control-host>/agent/ws`

If `ALLOY_CONTROL_WS_URL_DEFAULT` is unset, control falls back to the first non-loopback origin in `ALLOY_ALLOWED_ORIGINS`, then browser current origin.

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

Notes:

- Release tag and component versions can differ.
- Manifest `control.version` comes from `crates/alloy-control/Cargo.toml`.
- Manifest `agent.version` comes from `crates/alloy-agent/Cargo.toml`.

What CI does:

1. Build/push `alloy-agent`, `alloy-control`, `alloy-web` to GHCR
2. Tag images by both release tag (`vX.Y.Z`) and component tag (`alloy-control:vA.B.C`, `alloy-agent:vD.E.F`), so control/agent can evolve independently
3. Optionally mirror the same tags to DockerHub (if secrets are configured)
4. Generate `update-manifest.json` with independent `control` and `agent` versions
5. Upload manifest as release asset, so `releases/latest/download/update-manifest.json` always points to the newest published release

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
