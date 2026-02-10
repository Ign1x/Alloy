#!/usr/bin/env bash

set -euo pipefail

MODE="release"
OUTPUT=""
NO_UP=0

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
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

case "$MODE" in
  local|release) ;;
  *)
    echo "Invalid mode: $MODE (expected local or release)" >&2
    exit 1
    ;;
esac

SCRIPT_SOURCE="${BASH_SOURCE[0]-}"
if [[ -n "$SCRIPT_SOURCE" && -f "$SCRIPT_SOURCE" ]]; then
  SCRIPT_DIR="$(cd -- "$(dirname -- "$SCRIPT_SOURCE")" && pwd)"
  INSTALL_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
else
  INSTALL_ROOT="$(pwd)"
  SCRIPT_DIR="$INSTALL_ROOT/deploy"
  mkdir -p "$SCRIPT_DIR"
fi

ENV_FILE="$INSTALL_ROOT/.env"
TEMPLATE_LOCAL="$SCRIPT_DIR/docker-compose.${MODE}.yml"
TEMPLATE="$TEMPLATE_LOCAL"
TEMP_TEMPLATE=""

cleanup_temp_template() {
  if [[ -n "$TEMP_TEMPLATE" && -f "$TEMP_TEMPLATE" ]]; then
    rm -f "$TEMP_TEMPLATE"
  fi
}
trap cleanup_temp_template EXIT

if [[ ! -f "$TEMPLATE_LOCAL" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "Template not found locally: $TEMPLATE_LOCAL" >&2
    echo "curl is required to download compose template in stdin mode." >&2
    exit 1
  fi

  BASE_URL="${ALLOY_INSTALL_BASE_URL:-https://raw.githubusercontent.com/Ign1x/Alloy/alloy/deploy}"
  TEMPLATE_URL="${BASE_URL}/docker-compose.${MODE}.yml"
  TEMP_TEMPLATE="$(mktemp)"

  if ! curl -fsSL "$TEMPLATE_URL" -o "$TEMP_TEMPLATE"; then
    echo "Template not found locally and failed to download: $TEMPLATE_URL" >&2
    exit 1
  fi

  TEMPLATE="$TEMP_TEMPLATE"
fi

if [[ -z "$OUTPUT" ]]; then
  OUTPUT="$SCRIPT_DIR/docker-compose.generated.${MODE}.yml"
fi
mkdir -p "$(dirname -- "$OUTPUT")"

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
fi

cp "$TEMPLATE" "$OUTPUT"

echo "Generated compose: $OUTPUT"
echo "Env file: $ENV_FILE"

if [[ "$NO_UP" -eq 1 ]]; then
  echo "Skip docker compose (--no-up)."
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found in PATH" >&2
  exit 1
fi

sync_env_from_file "$ENV_FILE"

if [[ "$MODE" == "release" ]]; then
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" pull
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" up -d
else
  docker compose --env-file "$ENV_FILE" -f "$OUTPUT" up -d --build
fi
