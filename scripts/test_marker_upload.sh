#!/bin/bash

set -euo pipefail

ROOT_DIR="${OPEN_NOTEBOOK_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
TEST_ROOT="/tmp/open-notebook-marker-test"
DB_DIR="$TEST_ROOT/db"
LOG_DIR="$TEST_ROOT/logs"

DB_PORT="${DB_PORT:-18000}"
API_PORT="${API_PORT:-15055}"
IMAGE_PORT="${IMAGE_PORT:-18888}"
TEST_SURREAL_PASSWORD="${TEST_SURREAL_PASSWORD:-test-open-notebook-db-pass}"
TEST_ENCRYPTION_KEY="${TEST_ENCRYPTION_KEY:-test-open-notebook-encryption-key}"

PDF_PATH="${1:-}"

mkdir -p "$LOG_DIR"
rm -rf "$DB_DIR"
mkdir -p "$DB_DIR"

cleanup() {
  for pid in "${WORKER_PID:-}" "${IMAGE_PID:-}" "${API_PID:-}" "${DB_PID:-}"; do
    if [[ -n "${pid}" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}

trap cleanup EXIT

wait_for_url() {
  local url="$1"
  local name="$2"
  local attempts="${3:-60}"

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "$name ready: $url"
      return 0
    fi
    sleep 1
  done

  echo "$name failed to start: $url" >&2
  return 1
}

extract_json_field() {
  local field="$1"
  python -c "import json,sys; print(json.load(sys.stdin).get('$field', ''))"
}

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

SURREAL_BIN="${OPEN_NOTEBOOK_SURREAL_BIN:-surreal}"

echo "Starting isolated SurrealDB on :$DB_PORT"
"$SURREAL_BIN" start \
  --log warn \
  --user root \
  --pass "$TEST_SURREAL_PASSWORD" \
  --bind "127.0.0.1:$DB_PORT" \
  "rocksdb:$DB_DIR" >"$LOG_DIR/surreal.log" 2>&1 &
DB_PID=$!

wait_for_url "http://127.0.0.1:$DB_PORT/health" "SurrealDB"

echo "Starting image server on :$IMAGE_PORT"
pushd "$ROOT_DIR/images" >/dev/null
python3 -m http.server "$IMAGE_PORT" --bind 127.0.0.1 >"$LOG_DIR/images.log" 2>&1 &
IMAGE_PID=$!
popd >/dev/null

wait_for_url "http://127.0.0.1:$IMAGE_PORT/" "Image server"

echo "Starting API on :$API_PORT"
eval "$(conda shell.bash hook)"
conda activate open-notebook
cd "$ROOT_DIR"

export OPEN_NOTEBOOK_ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY"
export SURREAL_URL="ws://localhost:$DB_PORT/rpc"
export SURREAL_USER="root"
export SURREAL_PASSWORD="$TEST_SURREAL_PASSWORD"
export SURREAL_NAMESPACE="open_notebook"
export SURREAL_DATABASE="open_notebook"
export IMAGE_SERVER_URL="http://localhost:$IMAGE_PORT"
export PDF_CONVERSION_ENGINE="marker"

python -m uvicorn api.main:app --host 127.0.0.1 --port "$API_PORT" >"$LOG_DIR/api.log" 2>&1 &
API_PID=$!

wait_for_url "http://127.0.0.1:$API_PORT/docs" "API"

echo "Starting worker"
surreal-commands-worker --import-modules commands >"$LOG_DIR/worker.log" 2>&1 &
WORKER_PID=$!
sleep 3

echo "Creating notebook"
NOTEBOOK_JSON=$(
  curl -fsS \
    -H "Content-Type: application/json" \
    -d '{"name":"Marker Upload Test","description":"Sync API marker verification"}' \
    "http://127.0.0.1:$API_PORT/api/notebooks"
)
NOTEBOOK_ID=$(printf '%s' "$NOTEBOOK_JSON" | extract_json_field "id")

echo "Uploading PDF: $PDF_PATH"
UPLOAD_JSON=$(
  curl -fsS \
    -F "type=upload" \
    -F "notebooks=[\"$NOTEBOOK_ID\"]" \
    -F "embed=false" \
    -F "async_processing=true" \
    -F "file=@$PDF_PATH;type=application/pdf" \
    "http://127.0.0.1:$API_PORT/api/sources"
)
SOURCE_ID=$(printf '%s' "$UPLOAD_JSON" | extract_json_field "id")

echo "Polling source status"
STATUS=""
for ((i=1; i<=90; i++)); do
  STATUS_JSON=$(curl -fsS "http://127.0.0.1:$API_PORT/api/sources/$SOURCE_ID/status")
  STATUS=$(printf '%s' "$STATUS_JSON" | extract_json_field "status")
  if [[ "$STATUS" == "completed" ]]; then
    break
  fi
  if [[ "$STATUS" == "failed" ]]; then
    echo "Source processing failed" >&2
    printf '%s\n' "$STATUS_JSON" >&2
    exit 1
  fi
  sleep 2
done

if [[ "$STATUS" != "completed" ]]; then
  echo "Timed out waiting for source completion" >&2
  exit 1
fi

DETAIL_JSON=$(curl -fsS "http://127.0.0.1:$API_PORT/api/sources/$SOURCE_ID")

DETAIL_FILE="$TEST_ROOT/source-detail.json"
printf '%s\n' "$DETAIL_JSON" >"$DETAIL_FILE"

python - <<'PY' "$DETAIL_FILE"
import json
import re
import sys
from pathlib import Path

detail_path = Path(sys.argv[1])
detail = json.loads(detail_path.read_text())
full_text = detail.get("full_text") or ""
first_line = full_text.splitlines()[0] if full_text else ""
image_match = re.search(r"http://localhost:\d+/[^\s)]+", full_text)

print("SOURCE_ID:", detail.get("id"))
print("TITLE:", detail.get("title"))
print("HAS_FULL_TEXT:", bool(full_text))
print("FIRST_LINE:", first_line[:200])
print("IMAGE_URL:", image_match.group(0) if image_match else "")
print("FILE_PATH:", (detail.get("asset") or {}).get("file_path"))
print("FULL_TEXT_CHARS:", len(full_text))
PY

IMAGE_URL=$(python - <<'PY' "$DETAIL_FILE"
import json
import re
import sys
from pathlib import Path

detail = json.loads(Path(sys.argv[1]).read_text())
full_text = detail.get("full_text") or ""
match = re.search(r"http://localhost:\d+/[^\s)]+", full_text)
print(match.group(0) if match else "")
PY
)

if [[ -n "$IMAGE_URL" ]]; then
  echo "Checking extracted image URL"
  curl -fsS "$IMAGE_URL" >/dev/null
  echo "Image URL reachable: $IMAGE_URL"
else
  echo "No image URL found in markdown output"
fi

echo "Logs:"
echo "  $LOG_DIR/surreal.log"
echo "  $LOG_DIR/api.log"
echo "  $LOG_DIR/images.log"
echo "  $LOG_DIR/worker.log"
