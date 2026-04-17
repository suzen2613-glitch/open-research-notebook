#!/bin/bash
# Start API without proxy environment variables.

set -euo pipefail

ROOT="/home/sunshuheng/Downloads/open-notebook"
PYTHON_BIN="/home/sunshuheng/miniconda3/envs/open-notebook/bin/python"

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

cd "$ROOT"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ROOT/.env"
  set +a
fi

exec "$PYTHON_BIN" -m uvicorn api.main:app --host 0.0.0.0 --port 5055
