# Deployment (Docker)

This directory contains the Dockerized deployment for the current vertical slice
(web -> rspc -> alloy-control -> gRPC -> alloy-agent).

## Services
- `alloy-agent` (gRPC): container port `50051`
- `alloy-control` (HTTP): container port `8080` (serves `/healthz` and `/rspc`)
- `web` (nginx): container port `80` (serves SPA + proxies `/rspc` to control)

Default host ports (via compose):
- web: `http://localhost:3000`
- control: `http://localhost:8080`

## Quick start

Build and start:

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Stop:

```bash
docker compose -f deploy/docker-compose.yml down -v
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
```

Web (same-origin `/rspc`):

```bash
curl -fsS http://localhost:3000/ > /dev/null
curl -fsS "http://localhost:3000/rspc/control.ping?input=null"
```

## Configuration

`alloy-control` uses `ALLOY_AGENT_ENDPOINT` to find the agent gRPC endpoint.

- Local dev default: `http://127.0.0.1:50051`
- docker-compose: `http://alloy-agent:50051`
