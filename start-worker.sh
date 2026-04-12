#!/bin/bash
# Start worker without proxy environment variables
set -euo pipefail

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

PROJECT_DIR="${OPEN_NOTEBOOK_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
CONDA_PYTHON="${OPEN_NOTEBOOK_PYTHON_BIN:-python3}"
WORKER_BIN="${OPEN_NOTEBOOK_WORKER_BIN:-surreal-commands-worker}"

cd "$PROJECT_DIR"

# Load .env manually
set -a
source .env
set +a

WORKER_PATTERN="$WORKER_BIN --import-modules commands"
RESTART_DELAY=3

if pgrep -af "$WORKER_PATTERN" >/dev/null 2>&1; then
    echo "Worker is already running"
    exit 0
fi

while true; do
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting worker"
    "$WORKER_BIN" --import-modules commands
    exit_code=$?
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Worker exited with code $exit_code, restarting in ${RESTART_DELAY}s"
    sleep "$RESTART_DELAY"
done
