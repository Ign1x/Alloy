# Deployment (Docker)

This directory contains the Dockerized deployment for the current vertical slice
(web -> rspc -> alloy-control -> gRPC -> alloy-agent).

## Services
- `alloy-agent` (gRPC): container port `50051`
- `alloy-agent` (Minecraft): container port `25565` (published to host for server connections)
- `alloy-control` (HTTP): container port `8080` (serves `/healthz` and `/rspc`)
- `web` (nginx): container port `80` (serves SPA + proxies `/rspc` to control)

Default host ports (via compose):
- web: `http://localhost:3000`
- control: `http://localhost:8080`
- minecraft: `localhost:25565`
- terraria: `localhost:7777`

## Quick start

Build and start:

```bash
docker compose up -d --build
```

Stop:

```bash
docker compose down -v
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

## Terraria (vanilla)

Milestone 2 template id: `terraria:vanilla`

Optional params:
- `version` (default: 1453)
- `port` (default: 7777)
- `max_players` (default: 8)
- `world_name` (default: world)
- `world_size` (default: 1)
- `password` (optional)

Start (rspc):

```bash
curl -fsS -X POST -H 'content-type: application/json' \
  --data '{"template_id":"terraria:vanilla","params":{"version":"1453","port":"7777","max_players":"8","world_name":"world","world_size":"1"}}' \
  http://localhost:8080/rspc/process.start
```
```

## Configuration

`alloy-control` uses `ALLOY_AGENT_ENDPOINT` to find the agent gRPC endpoint.

- Local dev default: `http://127.0.0.1:50051`
- docker-compose: `http://alloy-agent:50051`
