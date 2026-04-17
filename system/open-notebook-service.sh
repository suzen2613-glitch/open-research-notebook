#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/config.sh"

TARGET_UNIT="open-notebook.target"
SERVICE_UNITS=(
  "open-notebook-surreal.service"
  "open-notebook-api.service"
  "open-notebook-worker.service"
  "open-notebook-frontend.service"
  "open-notebook-cloudflared.service"
)

usage() {
  cat <<'EOF'
Usage:
  bash system/open-notebook-service.sh install
  bash system/open-notebook-service.sh bootstrap
  bash system/open-notebook-service.sh start
  bash system/open-notebook-service.sh stop
  bash system/open-notebook-service.sh restart
  bash system/open-notebook-service.sh status
  bash system/open-notebook-service.sh logs [service] [lines]
  bash system/open-notebook-service.sh enable
  bash system/open-notebook-service.sh disable
  bash system/open-notebook-service.sh uninstall

Services:
  surreal | api | worker | frontend | cloudflared | target

Environment overrides:
  OPEN_NOTEBOOK_SYSTEMD_USER_DIR
    Override the unit install directory. Useful for dry runs to /tmp.
EOF
}

ensure_systemd_user() {
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "systemctl not found. systemd user services are unavailable." >&2
    exit 1
  fi
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "systemctl --user is unavailable in this session." >&2
    exit 1
  fi
}

install_dir_is_live() {
  [[ "$SYSTEMD_USER_DIR" == "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user" ]]
}

resolve_unit() {
  local name="${1:-target}"
  case "$name" in
    surreal|open-notebook-surreal.service) echo "open-notebook-surreal.service" ;;
    api|open-notebook-api.service) echo "open-notebook-api.service" ;;
    worker|open-notebook-worker.service) echo "open-notebook-worker.service" ;;
    frontend|open-notebook-frontend.service) echo "open-notebook-frontend.service" ;;
    cloudflared|open-notebook-cloudflared.service) echo "open-notebook-cloudflared.service" ;;
    target|open-notebook.target) echo "open-notebook.target" ;;
    *)
      echo "Unknown service '$name'" >&2
      exit 1
      ;;
  esac
}

render_units() {
  mkdir -p "$SYSTEMD_USER_DIR"
  local template
  for template in "$SYSTEMD_TEMPLATE_DIR"/*.service "$SYSTEMD_TEMPLATE_DIR"/*.target; do
    local out="$SYSTEMD_USER_DIR/$(basename "$template")"
    sed "s|__PROJECT_DIR__|$PROJECT_DIR|g" "$template" > "$out"
  done
  rm -f "$SYSTEMD_USER_DIR/open-notebook-images.service"
}

require_installed() {
  if ! systemd_unit_installed "$TARGET_UNIT"; then
    echo "systemd units are not installed in $SYSTEMD_USER_DIR" >&2
    echo "Run: bash system/open-notebook-service.sh install" >&2
    exit 1
  fi
}

cmd_install() {
  render_units
  if install_dir_is_live; then
    ensure_systemd_user
    systemctl --user daemon-reload
    echo "Installed units into $SYSTEMD_USER_DIR"
  else
    echo "Rendered units into $SYSTEMD_USER_DIR"
    echo "Skipped daemon-reload because this is not the live user systemd directory."
  fi
}

cmd_enable() {
  ensure_systemd_user
  require_installed
  systemctl --user enable "$TARGET_UNIT"
  cat <<EOF
Enabled $TARGET_UNIT.
The stack will auto-start on user login.
To keep it running after logout/reboot without an active login session, also run:
  sudo loginctl enable-linger $USER
EOF
}

cmd_start() {
  ensure_systemd_user
  require_installed
  systemctl --user start "$TARGET_UNIT"
  echo "Started Open Notebook systemd stack."
}

cmd_stop() {
  ensure_systemd_user
  if systemd_unit_installed "$TARGET_UNIT"; then
    systemctl --user stop "$TARGET_UNIT" "${SERVICE_UNITS[@]}" || true
    echo "Stopped Open Notebook systemd stack."
  else
    echo "systemd units are not installed in $SYSTEMD_USER_DIR" >&2
    exit 1
  fi
}

cmd_restart() {
  cmd_stop
  cmd_start
}

cmd_status() {
  ensure_systemd_user
  require_installed
  systemctl --user --no-pager --full status "$TARGET_UNIT" "${SERVICE_UNITS[@]}" || true
}

cmd_logs() {
  ensure_systemd_user
  require_installed
  local unit
  unit="$(resolve_unit "${1:-target}")"
  local lines="${2:-100}"
  journalctl --user -u "$unit" -n "$lines" --no-pager
}

cmd_disable() {
  ensure_systemd_user
  require_installed
  systemctl --user disable "$TARGET_UNIT"
  echo "Disabled $TARGET_UNIT."
}

cmd_uninstall() {
  ensure_systemd_user
  if systemd_unit_installed "$TARGET_UNIT"; then
    systemctl --user stop "$TARGET_UNIT" "${SERVICE_UNITS[@]}" || true
    systemctl --user disable "$TARGET_UNIT" >/dev/null 2>&1 || true
  fi

  rm -f "$SYSTEMD_USER_DIR/$TARGET_UNIT"
  local unit
  for unit in "${SERVICE_UNITS[@]}"; do
    rm -f "$SYSTEMD_USER_DIR/$unit"
  done
  rm -f "$SYSTEMD_USER_DIR/open-notebook-images.service"

  if install_dir_is_live; then
    systemctl --user daemon-reload
  fi
  echo "Removed Open Notebook systemd units from $SYSTEMD_USER_DIR"
}

cmd_bootstrap() {
  cmd_install
  if install_dir_is_live; then
    cmd_enable
    cmd_start
  else
    echo "Bootstrap skipped enable/start because units were rendered outside the live systemd directory."
  fi
}

command_name="${1:-}"
case "$command_name" in
  install)
    cmd_install
    ;;
  bootstrap)
    cmd_bootstrap
    ;;
  start)
    cmd_start
    ;;
  stop)
    cmd_stop
    ;;
  restart)
    cmd_restart
    ;;
  status)
    cmd_status
    ;;
  logs)
    shift || true
    cmd_logs "${1:-target}" "${2:-100}"
    ;;
  enable)
    cmd_enable
    ;;
  disable)
    cmd_disable
    ;;
  uninstall)
    cmd_uninstall
    ;;
  ""|-h|--help|help)
    usage
    ;;
  *)
    echo "Unknown command: $command_name" >&2
    usage >&2
    exit 1
    ;;
esac
