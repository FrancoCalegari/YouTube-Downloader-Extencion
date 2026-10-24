#!/usr/bin/env bash
# ==============================================================================
# YouTube Downloader & Converter - Desinstalador del Servicio para Linux
# ==============================================================================

SERVICE_NAME="yt-downloader"

ACTUAL_USER="${SUDO_USER:-$USER}"
ACTUAL_HOME="$(getent passwd "$ACTUAL_USER" 2>/dev/null | cut -d: -f6)"
ACTUAL_HOME="${ACTUAL_HOME:-$HOME}"
ACTUAL_UID="$(id -u "$ACTUAL_USER" 2>/dev/null || echo 1000)"

if [ "$EUID" -eq 0 ] && [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
  RUN_AS_USER="sudo -u $ACTUAL_USER XDG_RUNTIME_DIR=/run/user/$ACTUAL_UID DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/$ACTUAL_UID/bus"
else
  RUN_AS_USER=""
fi

USER_SERVICE="$ACTUAL_HOME/.config/systemd/user/${SERVICE_NAME}.service"
SYSTEM_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "Desinstalando servicio ${SERVICE_NAME}..."

# Detener y deshabilitar servicio de usuario
if $RUN_AS_USER systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "Deteniendo servicio de usuario..."
  $RUN_AS_USER systemctl --user stop "$SERVICE_NAME" || true
fi

if [ -f "$USER_SERVICE" ]; then
  echo "Eliminando $USER_SERVICE..."
  $RUN_AS_USER systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$USER_SERVICE"
  $RUN_AS_USER systemctl --user daemon-reload 2>/dev/null || true
fi

# Verificar si existía como servicio del sistema (root)
if [ -f "$SYSTEM_SERVICE" ]; then
  echo "Eliminando servicio global de sistema (requiere sudo)..."
  sudo systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  sudo systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  sudo rm -f "$SYSTEM_SERVICE"
  sudo systemctl daemon-reload 2>/dev/null || true
fi

echo "✅ El servicio ${SERVICE_NAME} ha sido desinstalado correctamente."
