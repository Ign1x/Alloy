ARG ELEGANTMC_VERSION=dev
ARG ELEGANTMC_REVISION=unknown
ARG ELEGANTMC_BUILD_DATE=unknown

FROM golang:1.22-bookworm AS builder
WORKDIR /src

ARG GOPROXY
ARG GOSUMDB
RUN if [ -n "$GOPROXY" ]; then go env -w GOPROXY="$GOPROXY"; fi
RUN if [ -n "$GOSUMDB" ]; then go env -w GOSUMDB="$GOSUMDB"; fi
ENV GOFLAGS=-mod=mod

COPY go.mod ./
RUN go mod download

COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/elegantmc-daemon ./cmd/elegantmc-daemon

# Runtime includes Java (so mc_start works inside the container).
FROM eclipse-temurin:21-jre-jammy AS runner
WORKDIR /app

COPY --from=builder /out/elegantmc-daemon /usr/local/bin/elegantmc-daemon

ARG ELEGANTMC_VERSION
ARG ELEGANTMC_REVISION
ARG ELEGANTMC_BUILD_DATE

LABEL org.opencontainers.image.title="ElegantMC Daemon" \
  org.opencontainers.image.description="ElegantMC Daemon (Go + WebSocket client + Minecraft/FRP manager)" \
  org.opencontainers.image.version="$ELEGANTMC_VERSION" \
  org.opencontainers.image.revision="$ELEGANTMC_REVISION" \
  org.opencontainers.image.created="$ELEGANTMC_BUILD_DATE"

ENV ELEGANTMC_BASE_DIR=/data
ENV ELEGANTMC_HEALTH_FILE=/data/healthz.txt
VOLUME ["/data"]

HEALTHCHECK --interval=10s --timeout=2s --start-period=10s --retries=3 \
  CMD ["sh","-c","test -f /data/healthz.txt && read ts conn < /data/healthz.txt && [ $(( $(date +%s) - ts )) -lt 60 ]"]

ENTRYPOINT ["elegantmc-daemon"]
