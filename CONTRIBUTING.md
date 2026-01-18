# Contributing to ElegantMC

Thanks for your interest in contributing!

## Repo Layout

- `panel/`: Next.js web panel (custom Node server)
- `daemon/`: Go daemon (connects out to Panel via WebSocket)
- `docker-compose.yml`: local dev/test stack

## Prerequisites

- Node.js 20+
- Go 1.22+
- (Optional) Docker + Docker Compose for running the full stack

## Local Development

### Panel

```bash
cd panel
npm ci
npm run dev
```

Panel listens on `http://0.0.0.0:3000` by default.

### Daemon

```bash
cd daemon
go test ./...
go run ./cmd/daemon
```

## Dev With Docker (Recommended)

```bash
docker compose up -d --build
```

Then open `http://127.0.0.1:3000`.

If you didn't set `ELEGANTMC_PANEL_ADMIN_PASSWORD`, the panel will print a generated password in logs:

```bash
docker compose logs panel
```

## Testing

### Panel

```bash
cd panel
npm run typecheck
npm run build
npm run smoke
```

### Daemon

```bash
cd daemon
gofmt -w .
go vet ./...
go test ./...
```

## Release Notes / Publishing

- Update `CHANGELOG.md`.
- Push a tag like `v1.2.3` to trigger the DockerHub publish workflow (`.github/workflows/dockerhub.yml`).

