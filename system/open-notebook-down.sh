#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

if systemd_unit_installed "open-notebook.target"; then
  bash "$SCRIPT_DIR/open-notebook-service.sh" stop || true
fi

terminate_pattern() {
  local label="$1"
  local pattern="$2"

  if pgrep -af "$pattern" >/dev/null 2>&1; then
    echo "Stopping $label..."
    pkill -f "$pattern" 2>/dev/null || true
    sleep 1
    pkill -9 -f "$pattern" 2>/dev/null || true
  fi
}

for name in cloudflared frontend worker api surreal; do
  pidf=$(pidfile "$name")
  if [[ -f "$pidf" ]]; then
    pid=$(cat "$pidf")
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pidf"
  fi
done

terminate_pattern "API" "uvicorn api.main:app"
terminate_pattern "Worker wrapper" "$PROJECT_DIR/start-worker.sh"
terminate_pattern "Worker" "surreal-commands-worker --import-modules commands"
terminate_pattern "Frontend" "next dev --hostname $FRONTEND_HOST --port $FRONTEND_PORT"
terminate_pattern "Frontend" "npm run dev -- --hostname $FRONTEND_HOST --port $FRONTEND_PORT"
terminate_pattern "Cloudflare Tunnel" "cloudflared tunnel run $CLOUDFLARED_TUNNEL"
terminate_pattern "SurrealDB" "$SURREAL_BIN start --log info --user $DB_USER"

echo "Open Notebook services stopped."
