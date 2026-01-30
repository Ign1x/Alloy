# syntax=docker/dockerfile:1

FROM rust:1.93-bookworm AS builder
WORKDIR /app

# Protobuf compiler for tonic/prost build.rs codegen.
RUN apt-get update \
  && apt-get install -y --no-install-recommends protobuf-compiler \
  && protoc --version \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN --mount=type=cache,target=/usr/local/cargo/registry/ \
    --mount=type=cache,target=/usr/local/cargo/git/db \
    --mount=type=cache,target=/app/target/ \
    set -eux; \
    cargo build --release -p alloy-agent --bin alloy-agent; \
    mkdir -p /out; \
    cp /app/target/release/alloy-agent /out/alloy-agent

FROM eclipse-temurin:21-jre-jammy AS java21

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Ship Java 21 without relying on Debian packages (bookworm doesn't include 21).
COPY --from=java21 /opt/java/openjdk /opt/java/openjdk
ENV JAVA_HOME=/opt/java/openjdk
ENV PATH=/opt/java/openjdk/bin:$PATH

# Default entrypoint runs the agent. For ad-hoc debugging, override with:
#   docker run --rm --entrypoint java <image> -version

COPY --from=builder /out/alloy-agent /usr/local/bin/alloy-agent

# Persistent data root for jar cache and instance directories.
ENV ALLOY_DATA_ROOT=/data

VOLUME ["/data"]

EXPOSE 50051

# Vanilla Minecraft default port (published via docker-compose).
EXPOSE 25565

ENTRYPOINT ["/usr/local/bin/alloy-agent"]
