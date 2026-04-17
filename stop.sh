#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
SYSTEM_DIR="$PROJECT_DIR/system"

echo "=== 1. 停止 Open Notebook 服务栈 ==="
bash "$SYSTEM_DIR/open-notebook-down.sh"

echo
echo "=== 全部已停止 ==="
