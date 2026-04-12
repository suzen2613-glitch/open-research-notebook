#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

if systemd_unit_installed "open-notebook.target"; then
  exec bash "$SCRIPT_DIR/open-notebook-service.sh" start
fi

start_if_missing() {
  local name="$1"; shift
  local pidf
  pidf=$(pidfile "$name")
  if [[ -f "$pidf" ]] && kill -0 "$(cat "$pidf")" 2>/dev/null; then
    echo "$name already running (pid $(cat "$pidf"))"
    return
  fi
  echo "Starting $name..."
  nohup bash -lc "$*" > "$LOG_DIR/$name.log" 2>&1 &
  local pid=$!
  echo $pid > "$pidf"
  sleep 2
  if ! kill -0 $pid 2>/dev/null; then
    echo "$name failed to stay running; see $LOG_DIR/$name.log" >&2
    return 1
  fi
}


start_if_missing surreal "'$SURREAL_BIN' start --log info --user '$DB_USER' --pass '$DB_PASS' --bind '$DB_HOST:$DB_PORT' rocksdb:'$DB_PATH'"
start_if_missing api "cd '$API_DIR' && '$CONDA_PYTHON' -m uvicorn api.main:app --host '$API_HOST' --port '$API_PORT'"
start_if_missing worker "cd '$PROJECT_DIR' && set -a && source .env && set +a && '$WORKER_BIN' --import-modules commands"
start_if_missing frontend "cd '$FRONTEND_DIR' && export PORT='$FRONTEND_PORT' && if command -v '$NPM_BIN' >/dev/null 2>&1; then '$NPM_BIN' run dev -- --hostname '$FRONTEND_HOST' --port '$FRONTEND_PORT'; else npm run dev -- --hostname '$FRONTEND_HOST' --port '$FRONTEND_PORT'; fi"
if [[ "$START_CLOUDFLARED" != "0" && "$START_CLOUDFLARED" != "false" && "$START_CLOUDFLARED" != "False" ]]; then
  start_if_missing cloudflared "'$CLOUDFLARED_BIN' tunnel run '$CLOUDFLARED_TUNNEL'"
else
  echo "cloudflared disabled (OPEN_NOTEBOOK_START_CLOUDFLARED=$START_CLOUDFLARED)"
fi

echo "Open Notebook services started."
echo "Frontend: http://localhost:$FRONTEND_PORT"
echo "API: http://localhost:$API_PORT"
echo "Images: http://localhost:$FRONTEND_PORT/api/images"
