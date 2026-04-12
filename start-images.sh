#!/bin/bash
# Start image server without proxy

unset HTTP_PROXY HTTPS_PROXY ALL_PROXY FTP_PROXY
unset http_proxy https_proxy all_proxy ftp_proxy

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE_DIR="${OPEN_NOTEBOOK_IMAGE_DIR:-$SCRIPT_DIR/images}"

cd "$IMAGE_DIR"
exec python3 -m http.server 8888 --bind 0.0.0.0
