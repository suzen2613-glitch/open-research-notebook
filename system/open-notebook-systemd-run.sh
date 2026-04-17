#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

service_name="${1:-}"
if [[ -z "$service_name" ]]; then
  echo "Usage: $0 <surreal|api|worker|frontend>" >&2
  exit 1
fi

case "$service_name" in
  surreal)
    export PATH="$(dirname "$SURREAL_BIN"):$PATH"
    exec "$SURREAL_BIN" start \
      --log info \
      --user "$DB_USER" \
      --pass "$DB_PASS" \
      --bind "$DB_HOST:$DB_PORT" \
      "rocksdb:$DB_PATH"
    ;;
  api)
    cd "$API_DIR"
    exec "$CONDA_PYTHON" -m uvicorn api.main:app --host "$API_HOST" --port "$API_PORT"
    ;;
  worker)
    cd "$PROJECT_DIR"
    set -a
    source .env
    set +a
    exec "$WORKER_BIN" --import-modules commands
    ;;
  frontend)
    cd "$FRONTEND_DIR"
    export PORT="$FRONTEND_PORT"
    export PATH="$(dirname "$NODE_BIN"):$PATH"
    exec "$NPM_BIN" run dev -- --hostname "$FRONTEND_HOST" --port "$FRONTEND_PORT"
    ;;
  cloudflared)
    if [[ "$START_CLOUDFLARED" == "0" || "$START_CLOUDFLARED" == "false" || "$START_CLOUDFLARED" == "False" ]]; then
      echo "cloudflared disabled by OPEN_NOTEBOOK_START_CLOUDFLARED=$START_CLOUDFLARED"
      exit 0
    fi
    if [[ ! -x "$CLOUDFLARED_BIN" ]]; then
      echo "cloudflared binary not found: $CLOUDFLARED_BIN" >&2
      exit 1
    fi
    export PATH="$(dirname "$CLOUDFLARED_BIN"):$PATH"
    exec "$CLOUDFLARED_BIN" tunnel run "$CLOUDFLARED_TUNNEL"
    ;;
  *)
    echo "Unknown service: $service_name" >&2
    exit 1
    ;;
esac
