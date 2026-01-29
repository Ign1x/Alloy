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

FROM debian:bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/alloy-agent /usr/local/bin/alloy-agent

EXPOSE 50051

ENTRYPOINT ["/usr/local/bin/alloy-agent"]
