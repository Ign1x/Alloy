FROM debian:bookworm-slim AS frp

ARG FRP_VERSION=0.54.0

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
      amd64) frp_arch=amd64 ;; \
      arm64) frp_arch=arm64 ;; \
      *) echo "unsupported arch: $arch" >&2; exit 1 ;; \
    esac; \
    mkdir -p /out; \
    curl -fsSL \
      --retry 5 \
      --retry-delay 2 \
      --retry-all-errors \
      --connect-timeout 15 \
      --max-time 600 \
      -o /tmp/frp.tgz \
      "https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/frp_${FRP_VERSION}_linux_${frp_arch}.tar.gz"; \
    tar -C /tmp -xzf /tmp/frp.tgz; \
    cp "/tmp/frp_${FRP_VERSION}_linux_${frp_arch}/frpc" /out/frpc; \
    cp "/tmp/frp_${FRP_VERSION}_linux_${frp_arch}/frps" /out/frps; \
    chmod +x /out/frpc /out/frps; \
    rm -rf /tmp/frp*;

FROM rust:1.93-bookworm AS builder
WORKDIR /app

# Protobuf compiler for tonic/prost build.rs codegen.
RUN apt-get update \
  && apt-get install -y --no-install-recommends protobuf-compiler \
  && protoc --version \
  && rm -rf /var/lib/apt/lists/*

COPY Cargo.toml Cargo.lock ./
COPY crates ./crates

RUN --mount=type=cache,target=/usr/local/cargo/registry/ \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/app/target/ \
    set -eux; \
    cargo build --release -p alloy-agent --bin alloy-agent; \
    mkdir -p /out; \
    cp /app/target/release/alloy-agent /out/alloy-agent;

FROM eclipse-temurin:21-jre-jammy AS java21

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libcurl4 \
    libgcc-s1 \
    libicu72 \
    libssl3 \
    libstdc++6 \
    zlib1g \
  && rm -rf /var/lib/apt/lists/*

# Ship Java 21 without relying on Debian packages (bookworm doesn't include 21).
COPY --from=java21 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH

# Default entrypoint runs the agent. For ad-hoc debugging, override with:
#   docker run --rm --entrypoint java <image> -version

COPY --from=builder /out/alloy-agent /usr/local/bin/alloy-agent
COPY --from=frp /out/frpc /usr/local/bin/frpc
COPY --from=frp /out/frps /usr/local/bin/frps

# Persistent data root for jar cache and instance directories.
ENV ALLOY_DATA_ROOT=/data

VOLUME ["/data"]

EXPOSE 50051

# Vanilla Minecraft default port (published via docker-compose).
EXPOSE 25565

# Vanilla Terraria default port (published via docker-compose).
EXPOSE 7777

ENTRYPOINT ["/usr/local/bin/alloy-agent"]
