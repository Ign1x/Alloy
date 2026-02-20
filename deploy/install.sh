#!/usr/bin/env bash

set -euo pipefail

MODE="release"
OUTPUT=""
NO_UP=0
CURRENT_STEP="init"

log_line() {
  local level="$1"
  shift
  printf '[alloy-install][%s][%s] %s\n' "$MODE" "$level" "$*"
}

log_info() {
  log_line "INFO" "$*"
}

log_warn() {
  log_line "WARN" "$*"
}

log_error() {
  log_line "ERROR" "$*" >&2
}

print_hint() {
  printf '  -> %s\n' "$*" >&2
}

fail_with_help() {
  local message="$1"
  shift || true
  log_error "$message"
  for hint in "$@"; do
    print_hint "$hint"
  done
  exit 1
}

on_error() {
  local exit_code=$?
  if [[ "$exit_code" -eq 0 ]]; then
    return
  fi

  log_error "Step '${CURRENT_STEP:-unknown}' failed while running: ${BASH_COMMAND:-unknown}"
  print_hint "Check docker daemon: docker info"
  print_hint "Render compose config: docker compose --env-file \"${ENV_FILE:-.env}\" -f \"${OUTPUT:-docker-compose.generated.${MODE}.yml}\" config"
  print_hint "Inspect logs: docker compose --env-file \"${ENV_FILE:-.env}\" -f \"${OUTPUT:-docker-compose.generated.${MODE}.yml}\" logs --tail=120"
  exit "$exit_code"
}
trap on_error ERR

usage() {
  cat <<'EOF'
Usage: deploy/install.sh [--mode local|release] [--output <path>] [--no-up]

Options:
  --mode    Deployment mode. Default: release
  --output  Generated compose file path.
            Default: deploy/docker-compose.generated.<mode>.yml
  --no-up   Only generate .env + compose file, do not run docker compose.
  -h, --help
EOF
}

while (($#)); do
  case "$1" in
    --mode)
      MODE="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT="${2:-}"
      shift 2
      ;;
    --no-up)
      NO_UP=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      log_error "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

case "$MODE" in
  local|release) ;;
  *)
    log_error "Invalid mode: $MODE (expected local or release)"
    exit 1
    ;;
esac

RUN_MODE="stdin"
SCRIPT_SOURCE="${BASH_SOURCE[0]-}"
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
  RUN_MODE="file"
  SCRIPT_DIR="$(cd -- "$(dirname -- "$SCRIPT_SOURCE")" && pwd)"
  INSTALL_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
else
  INSTALL_ROOT="$(pwd)"
  SCRIPT_DIR="$INSTALL_ROOT"
fi

ENV_FILE="$INSTALL_ROOT/.env"
if [[ "$RUN_MODE" == "file" ]]; then
  TEMPLATE_LOCAL="$SCRIPT_DIR/docker-compose.${MODE}.yml"
else
  TEMPLATE_LOCAL="$INSTALL_ROOT/docker-compose.${MODE}.yml"
  if [[ ! -f "$TEMPLATE_LOCAL" && -f "$INSTALL_ROOT/deploy/docker-compose.${MODE}.yml" ]]; then
    TEMPLATE_LOCAL="$INSTALL_ROOT/deploy/docker-compose.${MODE}.yml"
  fi
fi
TEMPLATE="$TEMPLATE_LOCAL"
TEMP_TEMPLATE=""

cleanup_temp_template() {
  if [[ -n "$TEMP_TEMPLATE" && -f "$TEMP_TEMPLATE" ]]; then
    rm -f "$TEMP_TEMPLATE"
  fi
}
trap cleanup_temp_template EXIT

ensure_dir_writable() {
  local dir="$1"
  local label="$2"
  mkdir -p "$dir"
  if [[ ! -d "$dir" ]]; then
    fail_with_help "$label directory is not accessible: $dir"
  fi

  local probe="$dir/.alloy-write-test-$$"
  if ! : > "$probe" 2>/dev/null; then
    fail_with_help "$label directory is not writable: $dir" "Grant write permission and rerun."
  fi
  rm -f "$probe"
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    fail_with_help "Required command not found: $cmd" "Install '$cmd' and rerun deploy/install.sh."
  fi
}

has_port_probe() {
  command -v ss >/dev/null 2>&1 || command -v lsof >/dev/null 2>&1 || command -v netstat >/dev/null 2>&1
}

port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -H -ltn "sport = :$port" 2>/dev/null | grep -q .
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
    return
  fi

  return 1
}

service_running() {
  local service="$1"
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" ps --status running --services 2>/dev/null | grep -Fxq "$service"
}

check_port_or_exit() {
  local port="$1"
  local service="$2"
  local label="$3"

  if ! has_port_probe; then
    log_warn "Skipping port check for $label because ss/lsof/netstat is unavailable."
    return
  fi

  if ! port_in_use "$port"; then
    return
  fi

  if service_running "$service"; then
    log_info "Port $port is already held by running compose service '$service'; continuing."
    return
  fi

  fail_with_help \
    "Port $port is already in use before starting $label." \
    "Stop the conflicting process (Linux: ss -ltnp \"sport = :$port\" or lsof -nP -iTCP:$port -sTCP:LISTEN)." \
    "Or update the port mapping in $OUTPUT and rerun."
}

require_env_value() {
  local key="$1"
  local value="${!key-}"
  if [[ -z "${value//[[:space:]]/}" ]]; then
    fail_with_help "Required environment variable '$key' is empty." "Set $key in $ENV_FILE and rerun."
  fi
}

if [[ ! -f "$TEMPLATE_LOCAL" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    fail_with_help \
      "Template not found locally: $TEMPLATE_LOCAL" \
      "curl is required to download compose template in stdin mode."
  fi

  BASE_URL="${ALLOY_INSTALL_BASE_URL:-https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy}"
  TEMPLATE_URL="${BASE_URL}/docker-compose.${MODE}.yml"
  TEMP_TEMPLATE="$(mktemp)"

  if ! curl -fsSL "$TEMPLATE_URL" -o "$TEMP_TEMPLATE"; then
    fail_with_help \
      "Template not found locally and failed to download: $TEMPLATE_URL" \
      "Set ALLOY_INSTALL_BASE_URL to a reachable source or run from a repository checkout."
  fi

  TEMPLATE="$TEMP_TEMPLATE"
fi

if [[ -z "$OUTPUT" ]]; then
  if [[ "$RUN_MODE" == "stdin" ]]; then
    OUTPUT="$INSTALL_ROOT/docker-compose.generated.${MODE}.yml"
  else
    OUTPUT="$SCRIPT_DIR/docker-compose.generated.${MODE}.yml"
  fi
fi
CURRENT_STEP="directory preflight"
ensure_dir_writable "$(dirname -- "$OUTPUT")" "compose output"
ensure_dir_writable "$(dirname -- "$ENV_FILE")" "env"

rand_hex() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
    return
  fi
  od -An -N "$bytes" -tx1 /dev/urandom | tr -d ' \n'
}

rand_b64url() {
  local bytes="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 "$bytes" | tr -d '\n' | tr '+/' '-_'
    return
  fi
  rand_hex "$bytes"
}

ensure_env_key() {
  local key="$1"
  local value="$2"
  local file="$3"

  touch "$file"

  if grep -q "^${key}=" "$file"; then
    local current
    current="$(grep "^${key}=" "$file" | head -n1 | cut -d= -f2-)"
    if [[ -n "$current" ]]; then
      return
    fi

    awk -v k="$key" -v v="$value" '
      BEGIN { replaced = 0 }
      $0 ~ ("^" k "=") {
        if (!replaced) {
          print k "=" v
          replaced = 1
        }
        next
      }
      { print }
      END {
        if (!replaced) {
          print k "=" v
        }
      }
    ' "$file" > "${file}.tmp"
    mv "${file}.tmp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

sync_env_from_file() {
  local file="$1"
  while IFS= read -r raw || [[ -n "$raw" ]]; do
    local line="${raw%$'\r'}"
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ "$line" != *=* ]] && continue

    local key="${line%%=*}"
    local value="${line#*=}"
    if [[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      export "$key=$value"
    fi
  done < "$file"
}

CURRENT_STEP="env bootstrap"
ensure_env_key "ALLOY_JWT_SECRET" "$(rand_b64url 48)" "$ENV_FILE"
ensure_env_key "ALLOY_ADMIN_USER" "admin" "$ENV_FILE"
ensure_env_key "ALLOY_ADMIN_PASS" "admin123456" "$ENV_FILE"
ensure_env_key "ALLOY_WATCHTOWER_TOKEN" "$(rand_hex 24)" "$ENV_FILE"

if [[ "$MODE" == "local" ]]; then
  ensure_env_key "ALLOY_POSTGRES_PASSWORD" "$(rand_hex 12)" "$ENV_FILE"
  ensure_env_key "ALLOY_CONTROL_BIND_ADDR" "127.0.0.1" "$ENV_FILE"
  ensure_env_key "ALLOY_WEB_BIND_ADDR" "127.0.0.1" "$ENV_FILE"
  ensure_env_key "ALLOY_AGENT_TRANSPORT" "auto" "$ENV_FILE"
  ensure_env_key "ALLOY_AGENT_CONNECT_TOKEN" "" "$ENV_FILE"
  ensure_env_key "ALLOY_ALLOW_UNAUTHENTICATED_AGENT_WS" "false" "$ENV_FILE"
else
  ensure_env_key "ALLOY_POSTGRES_DATA_DIR" "./alloy-postgres" "$ENV_FILE"
fi

sync_env_from_file "$ENV_FILE"

cp "$TEMPLATE" "$OUTPUT"

DATA_DIR=""
if [[ "$MODE" == "release" ]]; then
  CURRENT_STEP="release data directory preflight"
  COMPOSE_DIR="$(cd -- "$(dirname -- "$OUTPUT")" && pwd)"
  DATA_DIR_RAW="${ALLOY_POSTGRES_DATA_DIR:-./alloy-postgres}"
  if [[ "$DATA_DIR_RAW" == /* ]]; then
    DATA_DIR="$DATA_DIR_RAW"
  else
    DATA_DIR="$COMPOSE_DIR/$DATA_DIR_RAW"
  fi
  ensure_dir_writable "$DATA_DIR" "release postgres data"
fi

log_info "Generated compose: $OUTPUT"
log_info "Env file: $ENV_FILE"
if [[ -n "$DATA_DIR" ]]; then
  log_info "Release data dir: $DATA_DIR"
fi

if [[ "$NO_UP" -eq 1 ]]; then
  local_next="up -d"
  if [[ "$MODE" == "local" ]]; then
    local_next="up -d --build"
  fi
  log_info "Skip docker compose (--no-up)."
  print_hint "Next step: docker compose --env-file \"$ENV_FILE\" -f \"$OUTPUT\" $local_next"
  exit 0
fi

CURRENT_STEP="docker preflight"
require_command docker
if ! docker info >/dev/null 2>&1; then
  fail_with_help "Cannot connect to Docker daemon." "Start Docker and rerun deploy/install.sh."
fi
if ! docker compose version >/dev/null 2>&1; then
  fail_with_help "docker compose plugin is unavailable." "Install Docker Compose v2 and rerun deploy/install.sh."
fi

CURRENT_STEP="env validation"
sync_env_from_file "$ENV_FILE"
require_env_value "ALLOY_JWT_SECRET"
require_env_value "ALLOY_ADMIN_USER"
require_env_value "ALLOY_ADMIN_PASS"
require_env_value "ALLOY_WATCHTOWER_TOKEN"
if [[ "$MODE" == "local" ]]; then
  require_env_value "ALLOY_POSTGRES_PASSWORD"
else
  require_env_value "ALLOY_POSTGRES_DATA_DIR"
fi

CURRENT_STEP="port preflight"
if [[ "$MODE" == "release" ]]; then
  check_port_or_exit "10043" "web" "release web"
else
  check_port_or_exit "10043" "alloy-control" "local control"
  check_port_or_exit "3000" "web" "local web"
fi

CURRENT_STEP="docker compose up"
if [[ "$MODE" == "release" ]]; then
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" pull
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" up -d
else
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" up -d --build
fi

log_info "Deployment command completed successfully."
print_hint "Check status: docker compose --env-file \"$ENV_FILE\" -f \"$OUTPUT\" ps"
