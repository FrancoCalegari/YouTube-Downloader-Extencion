#!/usr/bin/env python3
"""
cli.py  —  Interfaz de linea de comandos para Multi Downloader (GABODEV).

Uso basico:
    python cli.py <URL>
    python cli.py <URL> --audio
    python cli.py <URL> --resolution 1080p
    python cli.py <URL> --output ~/Videos
    python cli.py <URL> --cookie-browser firefox
    python cli.py <URL> --cookie-file cookies.txt
    python cli.py <URL> --platform kick

Para ver la GUI usa:
    python main.py
"""

import argparse
import re
import sys
import threading
import traceback

from core import (
    SUPPORTED_RE,
    detect_platform,
    download_video,
    fetch_video_info,
    format_duration,
    get_available_qualities,
    get_downloads_dir,
)


# ── Colores ANSI ─────────────────────────────────────────────────────────────

def _supports_color() -> bool:
    """Devuelve True si la terminal soporta codigos ANSI."""
    return hasattr(sys.stdout, "isatty") and sys.stdout.isatty()


USE_COLOR = _supports_color()


def _c(text: str, code: str) -> str:
    return f"\033[{code}m{text}\033[0m" if USE_COLOR else text


def red(t):    return _c(t, "91")
def green(t):  return _c(t, "92")
def yellow(t): return _c(t, "93")
def cyan(t):   return _c(t, "96")
def bold(t):   return _c(t, "1")
def dim(t):    return _c(t, "2")


# ── Banner ─────────────────────────────────────────────────────────────────

BANNER = r"""
  __  __ _   _ _   _____ _____   ____   _____        ___   _    ___   ___   ___   ___
 |  \/  | | | | | |_   _|_ _\ \ / /\ \ / / _ \      |   \ | |  |  \ /  |  | _ \ | _ \
 | |\/| | |_| | |__ | |  | | \ V /  \ V /|  _/  ___ | |) || |__| . X . |  |  _/ |   /
 |_|  |_|\___/|____|___|___| \_/    |_| |_|    |___||___/ |____|_|\_|_|  |_|   |_|_\
"""

BANNER_SIMPLE = "== MULTI DOWNLOADER  //  GABODEV  //  CLI v3.0 =="


def _print_banner():
    try:
        print(red(bold(BANNER_SIMPLE)))
    except Exception:
        print(BANNER_SIMPLE)
    print(dim("   YouTube · TikTok · Instagram · Kick  |  Powered by yt-dlp"))
    print()


# ── Hook de progreso para terminal ────────────────────────────────────────────

class _CliProgressHook:
    """Imprime el progreso de descarga en la misma linea usando \\r."""

    def __init__(self):
        self._last_line_len = 0

    def __call__(self, d: dict):
        status = d.get("status", "")

        if status == "downloading":
            downloaded = d.get("downloaded_bytes") or 0
            total      = d.get("total_bytes") or d.get("total_bytes_estimate") or 0

            if total > 0:
                pct = downloaded / total * 100
            else:
                raw = re.sub(r"[^\d.]", "", d.get("_percent_str", "0"))
                try:
                    pct = float(raw)
                except ValueError:
                    pct = 0.0

            pct   = max(0.0, min(100.0, pct))
            bar   = _build_bar(pct)
            speed = d.get("_speed_str", "—").strip()
            eta   = d.get("_eta_str",   "—").strip()

            line = f"  {bar}  {cyan(f'{pct:5.1f}%')}  VEL: {yellow(speed)}  ETA: {dim(eta)}"
            # Sobreescribir la linea anterior
            sys.stdout.write(f"\r{line:<90}")
            sys.stdout.flush()

        elif status == "finished":
            sys.stdout.write(f"\r  {green(_build_bar(100.0))}  {green('100.0%')}  {dim('Procesando archivo final...')}{'':20}\n")
            sys.stdout.flush()

        elif status == "error":
            sys.stdout.write("\n")
            sys.stdout.flush()


def _build_bar(pct: float, width: int = 30) -> str:
    """Genera una barra de progreso ASCII."""
    filled = int(pct / 100 * width)
    bar = "█" * filled + "░" * (width - filled)
    if USE_COLOR:
        return f"\033[91m[{bar}]\033[0m"
    return f"[{bar}]"


# ── Helpers de visualizacion ──────────────────────────────────────────────────

def _print_info(info: dict, qualities: list):
    title    = info.get("title", "Sin titulo")
    channel  = info.get("channel") or info.get("uploader") or "Desconocido"
    duration = format_duration(info.get("duration"))
    platform = info.get("extractor_key", "").lower() or "desconocida"

    print(bold("── INFO DEL VIDEO ──────────────────────────────────────"))
    print(f"  {bold('Titulo:')}    {title}")
    print(f"  {bold('Canal:')}     {channel}")
    if duration:
        print(f"  {bold('Duracion:')} {duration}")
    print(f"  {bold('Calidades disponibles:')} {', '.join(qualities)}")
    print()


def _print_separator():
    print(dim("─" * 60))


# ── Validaciones ──────────────────────────────────────────────────────────────

def _validate_url(url: str, platform: str) -> bool:
    """Valida la URL. Si plataforma es 'auto', usa el regex; si es forzada, omite."""
    if platform != "auto":
        return True
    return bool(SUPPORTED_RE.search(url))


def _resolve_audio_bitrate(bitrate_str: str) -> str:
    """Normaliza el bitrate de audio al numero entero como string."""
    clean = bitrate_str.rstrip("k").strip()
    return clean if clean.isdigit() else "192"


# ── Funcion principal ─────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        prog="cli.py",
        description="Multi Downloader CLI — YouTube, TikTok, Instagram, Kick",
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=(
            "Ejemplos:\n"
            "  python cli.py https://youtu.be/dQw4w9WgXcQ\n"
            "  python cli.py https://youtu.be/dQw4w9WgXcQ --audio\n"
            "  python cli.py https://youtu.be/dQw4w9WgXcQ -r 720p\n"
            "  python cli.py https://www.tiktok.com/@user/video/123 -o ~/Videos\n"
            "  python cli.py https://www.instagram.com/reel/ABC -b firefox\n"
            "  python cli.py https://kick.com/user/videos/123\n"
            "\nPara la interfaz grafica usa:\n"
            "  python main.py"
        ),
    )

    parser.add_argument(
        "url",
        nargs="?",
        default=None,
        help="URL del video a descargar (opcional para modo interactivo).",
    )
    parser.add_argument(
        "-a", "--audio",
        action="store_true",
        dest="audio_only",
        help="Descargar solo el audio (MP3).",
    )
    parser.add_argument(
        "-r", "--resolution",
        metavar="RES",
        default="Mejor disponible",
        help=(
            "Calidad de video deseada.\n"
            "Ej: 1080p, 720p, 480p, 360p\n"
            "Default: 'Mejor disponible'"
        ),
    )
    parser.add_argument(
        "-q", "--audio-quality",
        metavar="BITRATE",
        default="192",
        help=(
            "Bitrate de audio para MP3.\n"
            "Ej: 128, 192, 256, 320\n"
            "Default: 192"
        ),
    )
    parser.add_argument(
        "-o", "--output",
        metavar="DIR",
        default=None,
        help=(
            "Directorio de destino para la descarga.\n"
            f"Default: {get_downloads_dir()}"
        ),
    )
    parser.add_argument(
        "-p", "--platform",
        choices=["auto", "youtube", "tiktok", "instagram", "kick"],
        default="auto",
        help="Forzar plataforma (default: auto-detectar por URL).",
    )
    parser.add_argument(
        "-b", "--cookie-browser",
        metavar="BROWSER",
        choices=["chrome", "firefox", "edge", "brave", "opera"],
        default=None,
        help=(
            "Usar cookies del navegador indicado.\n"
            "Requerido para Instagram y algunos videos privados.\n"
            "Opciones: chrome, firefox, edge, brave, opera"
        ),
    )
    parser.add_argument(
        "-c", "--cookie-file",
        metavar="FILE",
        default=None,
        help="Ruta a un archivo cookies.txt exportado.",
    )
    parser.add_argument(
        "--info-only",
        action="store_true",
        help="Solo mostrar info del video sin descargar.",
    )
    parser.add_argument(
        "--list-qualities",
        action="store_true",
        help="Listar calidades disponibles y salir.",
    )

    args = parser.parse_args()

    # ── Inicio ────────────────────────────────────────────────────────────────
    _print_banner()

    if not args.url:
        print(bold("── MODO INTERACTIVO ──────────────────────────────────────────────"))
        url = ""
        while not url:
            url = input(f"  {cyan('URL del video (o "24" para salir): ')}").strip()
            if url == "24":
                print(dim("  Saliendo..."))
                sys.exit(0)
        args.url = url
        
        print()
        print(f"  {bold('Formato:')}")
        print(f"    {cyan('1.')} Video (MP4)")
        print(f"    {cyan('2.')} Solo Audio (MP3)")
        mode = ""
        while mode not in ["1", "2"]:
            mode = input(f"  {cyan('Selecciona (1/2): ')}").strip()
        args.audio_only = (mode == "2")
        
        if args.audio_only:
            print()
            print(f"  {bold('Calidad de Audio (kbps):')}")
            print(f"    {cyan('1.')} 128")
            print(f"    {cyan('2.')} 192 (Recomendado)")
            print(f"    {cyan('3.')} 256")
            print(f"    {cyan('4.')} 320")
            q = input(f"  {cyan('Selecciona (1-4) [2]: ')}").strip()
            args.audio_quality = {"1": "128", "2": "192", "3": "256", "4": "320"}.get(q, "192")
        else:
            print()
            print(f"  {bold('Calidad de Video:')}")
            print(f"    {cyan('1.')} Mejor disponible (Recomendado)")
            print(f"    {cyan('2.')} 1080p")
            print(f"    {cyan('3.')} 720p")
            print(f"    {cyan('4.')} Elegir despues de analizar")
            q = input(f"  {cyan('Selecciona (1-4) [1]: ')}").strip()
            args.resolution = {"1": "Mejor disponible", "2": "1080p", "3": "720p", "4": "ask"}.get(q, "Mejor disponible")
        
        print()

    url      = args.url.strip()
    platform = args.platform

    # Validar URL
    if not _validate_url(url, platform):
        print(red("  ERROR: URL no reconocida para ninguna plataforma admitida."))
        print(dim("  Plataformas: YouTube, YouTube Music, TikTok, Instagram Reels, Kick"))
        print(dim("  Usa -p para forzar una plataforma especifica."))
        sys.exit(1)

    detected = detect_platform(url) if platform == "auto" else platform
    print(f"  {bold('URL:')}       {url}")
    print(f"  {bold('Plataforma:')} {cyan(detected.upper())}")
    if args.audio_only:
        bitrate = _resolve_audio_bitrate(args.audio_quality)
        print(f"  {bold('Modo:')}      {yellow('Solo Audio (MP3)')}  |  Bitrate: {bitrate}k")
    else:
        print(f"  {bold('Modo:')}      {yellow('Video')}  |  Calidad: {args.resolution}")

    output_dir = args.output or get_downloads_dir()
    print(f"  {bold('Destino:')}   {output_dir}")
    print()

    # ── Obtener info del video ────────────────────────────────────────────────
    print(f"  {dim('Obteniendo informacion del video...')}", end="", flush=True)
    try:
        info = fetch_video_info(
            url,
            platform=platform,
            cookie_browser=args.cookie_browser,
            cookie_file=args.cookie_file,
        )
    except Exception as exc:
        print(f"\r  {red('ERROR al obtener info del video:')}{'':20}")
        print(f"  {red(str(exc))}")
        if "--debug" in sys.argv:
            traceback.print_exc()
        sys.exit(1)

    print(f"\r  {green('INFO obtenida correctamente.')}{'':30}")
    print()

    qualities = get_available_qualities(info)
    _print_info(info, qualities)

    if args.resolution == "ask":
        _print_separator()
        print(f"  {bold('Calidades disponibles:')}")
        for i, q in enumerate(qualities, 1):
            marker = green(" <-- recomendada") if q == qualities[-2] and len(qualities) > 1 else ""
            print(f"    {cyan(f'{i}.')} {q}{marker}")
        
        sel = ""
        while not sel.isdigit() or not (1 <= int(sel) <= len(qualities)):
            sel = input(f"  {cyan(f'Selecciona (1-{len(qualities)}): ')}").strip()
        args.resolution = qualities[int(sel)-1]
        print()

    # ── Modo info-only / list-qualities ───────────────────────────────────────
    if args.info_only or args.list_qualities:
        _print_separator()
        print(f"  {bold('Calidades disponibles:')}")
        for q in qualities:
            marker = green(" <-- recomendada") if q == qualities[-2] and len(qualities) > 1 else ""
            print(f"    {cyan(q)}{marker}")
        sys.exit(0)

    # ── Validar calidad seleccionada ──────────────────────────────────────────
    if not args.audio_only and args.resolution not in qualities and args.resolution != "Mejor disponible":
        print(yellow(f"  AVISO: La calidad '{args.resolution}' no esta en la lista de calidades detectadas."))
        print(yellow(f"  yt-dlp intentara la mejor opcion cercana disponible."))
        print()

    # Elegir calidad por defecto (la mas alta disponible)
    quality = args.resolution
    if quality == "Mejor disponible" and not args.audio_only and len(qualities) >= 2:
        quality = qualities[-2]  # Penultima (la mas alta con nombre), no "Mejor disponible"

    # ── Descarga ──────────────────────────────────────────────────────────────
    mode_str = "AUDIO (MP3)" if args.audio_only else f"VIDEO ({quality})"
    _print_separator()
    print(f"  {bold('Iniciando descarga:')} {yellow(mode_str)}")
    print()

    hook = _CliProgressHook()

    try:
        download_video(
            url,
            platform=platform,
            quality=quality,
            audio_only=args.audio_only,
            audio_bitrate=_resolve_audio_bitrate(args.audio_quality),
            download_dir=output_dir,
            cookie_browser=args.cookie_browser,
            cookie_file=args.cookie_file,
            progress_hook=hook,
            video_info=info,
        )
    except Exception as exc:
        print(f"\n  {red('ERROR durante la descarga:')}")
        print(f"  {red(str(exc))}")
        if "--debug" in sys.argv:
            traceback.print_exc()
        sys.exit(1)

    # ── Exito ─────────────────────────────────────────────────────────────────
    _print_separator()
    print()
    print(f"  {green(bold('DESCARGA COMPLETADA'))} {green('✓')}")
    print(f"  {bold('Guardado en:')} {output_dir}")
    print()


if __name__ == "__main__":
    main()
