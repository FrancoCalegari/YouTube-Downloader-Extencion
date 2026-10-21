#!/usr/bin/env bash
# ==============================================================================
# YouTube Downloader & Converter - Desinstalador del Servicio para Linux
# ==============================================================================

SERVICE_NAME="yt-downloader"
USER_SERVICE="$HOME/.config/systemd/user/${SERVICE_NAME}.service"
SYSTEM_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"

echo "Desinstalando servicio ${SERVICE_NAME}..."

# Detener y deshabilitar servicio de usuario
if systemctl --user is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "Deteniendo servicio de usuario..."
  systemctl --user stop "$SERVICE_NAME" || true
fi

if [ -f "$USER_SERVICE" ]; then
  echo "Eliminando $USER_SERVICE..."
  systemctl --user disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "$USER_SERVICE"
  systemctl --user daemon-reload 2>/dev/null || true
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
