#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

if systemd_unit_installed "open-notebook.target"; then
  exec bash "$SCRIPT_DIR/open-notebook-service.sh" status
fi

echo "=== PID files ==="
for name in surreal api worker frontend cloudflared; do
  pidf=$(pidfile "$name")
  if [[ -f "$pidf" ]]; then
    pid=$(cat "$pidf")
    if kill -0 "$pid" 2>/dev/null; then
      echo "$name: RUNNING pid=$pid"
    else
      echo "$name: STALE pidfile=$pid"
    fi
  else
    echo "$name: not tracked"
  fi
done
echo
echo "=== Ports ==="
ss -ltnp '( sport = :3000 or sport = :5055 or sport = :8000 )' || true
echo

echo "=== Health checks ==="
(curl -s http://127.0.0.1:$API_PORT/ | head -c 200 && echo) || echo "API unavailable"
auth_args=()
if [[ -n "${OPEN_NOTEBOOK_PASSWORD:-}" ]]; then
  auth_args=(-H "Authorization: Bearer ${OPEN_NOTEBOOK_PASSWORD}")
fi
(curl -s "${auth_args[@]}" http://127.0.0.1:$API_PORT/api/zotero/collections | head -c 200 && echo) || echo "Zotero API unavailable"

echo "=== Logs ==="
echo "$LOG_DIR"
