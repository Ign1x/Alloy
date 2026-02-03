# Deployment (Docker)

This directory contains the Dockerized deployment for the current vertical slice
(web -> rspc -> alloy-control -> gRPC -> alloy-agent).

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

`alloy-control` uses `ALLOY_AGENT_ENDPOINT` to find the agent gRPC endpoint.

- Local dev default: `http://127.0.0.1:50051`
- docker-compose (host-networked agent): `http://host.docker.internal:50051` (via `extra_hosts: host-gateway`)
