#!/usr/bin/env bash
# ==============================================================================
# YouTube Downloader & Converter - Instalador de Servicio para Linux
# Compatible con: Ubuntu, Debian, Linux Mint, Arch Linux, Manjaro, Fedora
# Puerto configurado: 23458
# ==============================================================================

set -e

# Colores para terminal
CLR_RESET="\033[0m"
CLR_BOLD="\033[1m"
CLR_GREEN="\033[32m"
CLR_CYAN="\033[36m"
CLR_YELLOW="\033[33m"
CLR_RED="\033[31m"
CLR_PURPLE="\033[35m"

print_title() {
  echo -e "\n${CLR_PURPLE}${CLR_BOLD}======================================================${CLR_RESET}"
  echo -e "${CLR_PURPLE}${CLR_BOLD}  $1${CLR_RESET}"
  echo -e "${CLR_PURPLE}${CLR_BOLD}======================================================${CLR_RESET}\n"
}

print_info()  { echo -e " ${CLR_CYAN}[INFO]${CLR_RESET} $1"; }
print_ok()    { echo -e " ${CLR_GREEN}[OK]${CLR_RESET} $1"; }
print_warn()  { echo -e " ${CLR_YELLOW}[WARN]${CLR_RESET} $1"; }
print_error() { echo -e " ${CLR_RED}[ERROR]${CLR_RESET} $1"; }

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=23458
SERVICE_NAME="yt-downloader"

print_title "Instalador del Servicio Backend - YouTube Downloader"
print_info "Directorio del proyecto: ${CLR_BOLD}${PROJECT_DIR}${CLR_RESET}"
print_info "Puerto asignado: ${CLR_BOLD}${PORT}${CLR_RESET}"

# ------------------------------------------------------------------------------
# 1. Detección de Distribución Linux
# ------------------------------------------------------------------------------
DISTRO="unknown"
PKG_MGR="unknown"

if [ -f /etc/os-release ]; then
  . /etc/os-release
  DISTRO=$ID
  DISTRO_LIKE=${ID_LIKE:-""}
fi

print_info "Distribución detectada: ${CLR_BOLD}${NAME:-$DISTRO}${CLR_RESET}"

if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v pacman >/dev/null 2>&1; then
  PKG_MGR="pacman"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
fi

# ------------------------------------------------------------------------------
# 2. Verificación e Instalación de Dependencias del Sistema
# ------------------------------------------------------------------------------
MISSING_PKGS=()

check_or_add_pkg() {
  local cmd_name="$1"
  local pkg_name="$2"
  if ! command -v "$cmd_name" >/dev/null 2>&1; then
    MISSING_PKGS+=("$pkg_name")
  fi
}

check_or_add_pkg "node" "nodejs"
check_or_add_pkg "npm" "npm"
check_or_add_pkg "ffmpeg" "ffmpeg"
check_or_add_pkg "yt-dlp" "yt-dlp"

if [ ${#MISSING_PKGS[@]} -gt 0 ]; then
  print_warn "Se detectaron dependencias faltantes: ${MISSING_PKGS[*]}"
  print_info "Intentando instalar dependencias con ${PKG_MGR}..."

  if [ "$EUID" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO_CMD="sudo"
  else
    SUDO_CMD=""
  fi

  case "$PKG_MGR" in
    apt)
      $SUDO_CMD apt-get update -y
      $SUDO_CMD apt-get install -y "${MISSING_PKGS[@]}" || {
        print_warn "No se pudo instalar algún paquete vía apt, intentando instalación alternativa para yt-dlp..."
      }
      ;;
    pacman)
      $SUDO_CMD pacman -Sy --noconfirm "${MISSING_PKGS[@]}"
      ;;
    dnf)
      $SUDO_CMD dnf install -y "${MISSING_PKGS[@]}"
      ;;
    *)
      print_warn "Gestor de paquetes no reconocido. Por favor asegúrate de tener instalados: ${MISSING_PKGS[*]}"
      ;;
  esac
fi

# Verificar yt-dlp nuevamente
if ! command -v yt-dlp >/dev/null 2>&1; then
  print_info "Instalando binario oficial de yt-dlp..."
  TMP_BIN="/tmp/yt-dlp"
  curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o "$TMP_BIN"
  chmod a+rx "$TMP_BIN"
  if [ "$EUID" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    sudo mv "$TMP_BIN" /usr/local/bin/yt-dlp
  else
    mv "$TMP_BIN" /usr/local/bin/yt-dlp || mkdir -p "$HOME/.local/bin" && mv "$TMP_BIN" "$HOME/.local/bin/yt-dlp"
  fi
fi

NODE_BIN="$(command -v node || echo "/usr/bin/node")"
FFMPEG_BIN="$(command -v ffmpeg || echo "/usr/bin/ffmpeg")"
YTDLP_BIN="$(command -v yt-dlp || echo "/usr/bin/yt-dlp")"

print_ok "Node.js:  $($NODE_BIN -v) ($NODE_BIN)"
print_ok "FFmpeg:   $FFMPEG_BIN"
print_ok "yt-dlp:   $($YTDLP_BIN --version 2>/dev/null || echo "ok") ($YTDLP_BIN)"

# ------------------------------------------------------------------------------
# 3. Configuración de Archivo .env
# ------------------------------------------------------------------------------
ENV_FILE="$PROJECT_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  if [ -f "$PROJECT_DIR/.env.example" ]; then
    cp "$PROJECT_DIR/.env.example" "$ENV_FILE"
    print_ok "Archivo .env creado a partir de .env.example"
  fi
fi

# Asegurar que el puerto sea 23458
if grep -q "^PORT=" "$ENV_FILE" 2>/dev/null; then
  sed -i 's/^PORT=.*/PORT=23458/' "$ENV_FILE"
else
  echo "PORT=23458" >> "$ENV_FILE"
fi

# ------------------------------------------------------------------------------
# 4. Instalación de Dependencias Node.js
# ------------------------------------------------------------------------------
print_info "Instalando dependencias de Node.js..."
cd "$PROJECT_DIR"
npm install --silent
print_ok "Dependencias de Node.js instaladas correctamente"

# Crear carpeta de descargas
mkdir -p "$PROJECT_DIR/downloads"

# ------------------------------------------------------------------------------
# 5. Configuración del Servicio systemd
# ------------------------------------------------------------------------------
print_info "Configurando servicio systemd para inicio automático con la computadora..."

# Usar servicio de usuario systemd (óptimo para escritorios, permisos de usuario y descargas)
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$USER_SYSTEMD_DIR"
SERVICE_FILE="$USER_SYSTEMD_DIR/${SERVICE_NAME}.service"

cat << EOF > "$SERVICE_FILE"
[Unit]
Description=YouTube Downloader & Converter Backend Service (Port ${PORT})
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${PROJECT_DIR}
ExecStart=${NODE_BIN} server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=${PORT}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF

print_ok "Unidad de servicio creada en: $SERVICE_FILE"

# Recargar systemd y habilitar servicio
systemctl --user daemon-reload
systemctl --user enable "${SERVICE_NAME}.service"
systemctl --user restart "${SERVICE_NAME}.service"

# Habilitar persistencia (linger) para que inicie aunque no haya sesión gráfica abierta
if command -v loginctl >/dev/null 2>&1; then
  loginctl enable-linger "$USER" 2>/dev/null || true
fi

# ------------------------------------------------------------------------------
# 6. Verificación de Funcionamiento
# ------------------------------------------------------------------------------
print_info "Esperando que el servicio inicie..."
sleep 2

HEALTH_CHECK=0
for i in {1..5}; do
  if curl -s "http://localhost:${PORT}/api/health" | grep -q '"status":"ok"'; then
    HEALTH_CHECK=1
    break
  fi
  sleep 1
done

if [ $HEALTH_CHECK -eq 1 ]; then
  print_title "¡Instalación completada con ÉXITO!"
  echo -e "🟢 ${CLR_GREEN}${CLR_BOLD}El backend está funcionando como servicio en segundo plano.${CLR_RESET}"
  echo -e "🌐 ${CLR_BOLD}URL del Backend:${CLR_RESET}   http://localhost:${PORT}"
  echo -e "📁 ${CLR_BOLD}Descargas:${CLR_RESET}         ${PROJECT_DIR}/downloads"
  echo -e "⚡ ${CLR_BOLD}Inicio automático:${CLR_RESET} Activado con el sistema (systemd --user)"
  echo ""
  echo -e "${CLR_BOLD}Comandos útiles para gestionar el servicio:${CLR_RESET}"
  echo -e "  • Ver estado:     ${CLR_CYAN}systemctl --user status ${SERVICE_NAME}${CLR_RESET}"
  echo -e "  • Reiniciar:      ${CLR_CYAN}systemctl --user restart ${SERVICE_NAME}${CLR_RESET}"
  echo -e "  • Detener:        ${CLR_CYAN}systemctl --user stop ${SERVICE_NAME}${CLR_RESET}"
  echo -e "  • Ver registros:  ${CLR_CYAN}journalctl --user -u ${SERVICE_NAME} -f${CLR_RESET}"
  echo -e "  • Desinstalar:    ${CLR_CYAN}./uninstall.sh${CLR_RESET}"
  echo ""
else
  print_warn "El servicio fue configurado pero no respondió inmediatamente en http://localhost:${PORT}."
  print_info "Verifica el estado ejecutando: systemctl --user status ${SERVICE_NAME}"
fi
