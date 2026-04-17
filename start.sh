#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
SYSTEM_DIR="$PROJECT_DIR/system"
ENV_FILE="$PROJECT_DIR/.env"

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PUBLIC_URL="${OPEN_NOTEBOOK_PUBLIC_URL:-https://notebook.example.com}"

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts="${3:-20}"
  local sleep_seconds="${4:-2}"
  local i

  for ((i = 1; i <= attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "    $label OK ($url)"
      return 0
    fi
    sleep "$sleep_seconds"
  done

  echo "    $label 启动失败，检查: $url" >&2
  return 1
}

echo "=== 1. 启动 Open Notebook 服务栈 ==="
bash "$SYSTEM_DIR/open-notebook-up.sh"

echo "=== 2. 健康检查 ==="
wait_for_http "http://127.0.0.1:8000/health" "SurrealDB" 20 1
wait_for_http "http://127.0.0.1:5055/health" "API" 20 2
wait_for_http "http://127.0.0.1:3000/config" "前端" 30 2

if pgrep -af "surreal-commands-worker --import-modules commands" >/dev/null 2>&1; then
  echo "    Worker OK"
else
  echo "    Worker 未检测到，检查日志: /tmp/open-notebook/worker.log"
fi

echo
echo "=== 全部启动完成 ==="
echo "本地访问: http://localhost:3000"
echo "公网访问: $PUBLIC_URL"
echo
echo "停止所有服务请运行: bash $PROJECT_DIR/stop.sh"
