#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/config.sh"
if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <collection_id> [notebook_id]"
  exit 1
fi
collection_id="$1"
notebook_ids='[]'
if [[ $# -ge 2 && -n "${2:-}" ]]; then
  notebook_ids="[\"$2\"]"
fi
auth_args=()
if [[ -n "${OPEN_NOTEBOOK_PASSWORD:-}" ]]; then
  auth_args=(-H "Authorization: Bearer ${OPEN_NOTEBOOK_PASSWORD}")
fi
curl -s -X POST "http://127.0.0.1:$API_PORT/api/zotero/import" \
  "${auth_args[@]}" \
  -H 'Content-Type: application/json' \
  -d "{\"collection_id\":$collection_id,\"notebook_ids\":$notebook_ids,\"embed\":true,\"skip_existing\":true}"
echo
