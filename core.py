"""
core.py  —  Lógica de descarga compartida entre la GUI (main.py) y la CLI (cli.py).

No importa ningún módulo de UI (tkinter, customtkinter).
Todos los callbacks de progreso se inyectan como funciones externas para
permitir que tanto la GUI como la terminal consuman los eventos.
"""

import os
import re
import shutil
import sys
from pathlib import Path
from typing import Callable, Optional

import yt_dlp

try:
    from curl_cffi import requests as creqs
except ImportError:
    creqs = None

import requests


# ── Constantes ────────────────────────────────────────────────────────────────

HTTP_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

SUPPORTED_RE = re.compile(
    r'^(https?://)?('
    # YouTube / YouTube Music
    r'((www|music|m)\.)?youtube\.com/(watch|shorts|embed|v|playlist|browse|channel|user)?'
    r'|youtu\.be/'
    # TikTok
    r'|(www\.)?tiktok\.com/@[\w.]+/video/'
    r'|vm\.tiktok\.com/'
    r'|vt\.tiktok\.com/'
    # Instagram
    r'|(www\.)?instagram\.com/(reels?|p|tv)/'
    # Facebook
    r'|(www\.|m\.|web\.)?facebook\.com/(watch/?\?v=|reel/|reels/|share/[vr]/|[\w.-]+/videos/|video\.php\?v=)'
    r'|fb\.watch/'
    # Kick
    r'|(www\.)?kick\.com/[\w.-]+/(videos?/[\w-]+|clip/[\w-]+|[\S]*)'
    r')[\S]*$',
    re.IGNORECASE,
)

STANDARD_HEIGHTS = [144, 240, 360, 480, 720, 1080, 1440, 2160]


# ── Helpers de plataforma ────────────────────────────────────────────────────

def detect_platform(url: str) -> str:
    """Devuelve 'youtube', 'tiktok', 'instagram', 'facebook' o 'kick' segun la URL."""
    u = url.lower()
    if 'tiktok.com' in u:
        return 'tiktok'
    if 'instagram.com' in u:
        return 'instagram'
    if 'facebook.com' in u or 'fb.watch' in u:
        return 'facebook'
    if 'kick.com' in u:
        return 'kick'
    return 'youtube'


def get_downloads_dir() -> str:
    """Carpeta de descargas predeterminada, independiente de la ubicacion de ejecucion."""
    base = Path.home() / "Downloads" / "YT-Downloader"
    base.mkdir(parents=True, exist_ok=True)
    return str(base)


def format_duration(seconds) -> str:
    """Formatea segundos como h:mm:ss o m:ss."""
    if not seconds:
        return ""
    seconds = int(seconds)
    h, rem = divmod(seconds, 3600)
    m, s = divmod(rem, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


def _detect_js_runtimes() -> dict:
    """Devuelve un dict de runtimes JS disponibles (node/deno) para yt-dlp."""
    runtimes = {}
    node = shutil.which("node")
    deno = shutil.which("deno")
    if node:
        runtimes["node"] = {"path": node}
    if deno:
        runtimes["deno"] = {"path": deno}
    return runtimes


# ── Kick ─────────────────────────────────────────────────────────────────────

def resolve_kick_video(url: str) -> Optional[dict]:
    """
    Extrae directamente el stream master.m3u8, titulo, thumbnail y duracion de Kick
    saltando las restricciones de Cloudflare usando curl_cffi.
    """
    client = creqs or requests
    req_kwargs = {"timeout": 15}
    if creqs:
        req_kwargs["impersonate"] = "chrome124"

    vod_match     = re.search(r'kick\.com/([\w.-]+)/videos?/([\w-]+)', url, re.I)
    clip_match    = re.search(r'kick\.com/(?:[\w.-]+/(?:clips?/|\?clip=)|clip/)([\w-]+)', url, re.I)
    channel_match = re.search(r'kick\.com/([\w.-]+)/?$', url, re.I)

    if vod_match:
        channel_slug, video_id = vod_match.group(1), vod_match.group(2)
        try:
            api_url = f"https://kick.com/api/v2/channels/{channel_slug}/videos"
            resp = client.get(api_url, **req_kwargs)
            if resp.status_code == 200:
                videos = resp.json()
                target = None
                for v in videos:
                    if video_id in str(v.get('slug', '')) or video_id in str(v.get('id', '')):
                        target = v
                        break
                if not target and len(videos) > 0:
                    target = videos[0]
                if target and target.get('source'):
                    thumb = target.get('thumbnail', {})
                    thumb_url = thumb.get('src') if isinstance(thumb, dict) else str(thumb)
                    return {
                        'url': target['source'],
                        'title': target.get('session_title') or f"Kick VOD - {channel_slug}",
                        'channel': channel_slug,
                        'thumbnail': thumb_url,
                        'duration': (target.get('duration') or 0) / 1000,
                    }
        except Exception as e:
            print(f"Kick VOD API error: {e}")

        # Fallback: scraping HTML
        try:
            page_resp = client.get(url, **req_kwargs)
            if page_resp.status_code == 200:
                html = page_resp.text
                og_title = re.search(r'<meta property="og:title" content="(.*?)"', html)
                og_desc  = re.search(r'<meta property="og:description" content="(.*?)"', html)
                og_img   = re.search(r'<meta property="og:image" content="(.*?)"', html)
                title    = (og_desc.group(1) if og_desc else None) or (og_title.group(1) if og_title else f"Kick VOD - {channel_slug}")
                m3u8_match = re.search(r'(https://stream\.kick\.com/[^\s"\'<>]+\.m3u8)', html)
                if m3u8_match:
                    return {
                        'url': m3u8_match.group(1),
                        'title': title,
                        'channel': channel_slug,
                        'thumbnail': og_img.group(1) if og_img else None,
                        'duration': None,
                    }
        except Exception as e:
            print(f"Kick HTML scrape error: {e}")

    elif clip_match:
        clip_id = clip_match.group(1)
        try:
            api_url = f"https://kick.com/api/v2/clips/{clip_id}/play"
            resp = client.get(api_url, **req_kwargs)
            if resp.status_code == 200:
                data = resp.json().get('clip', {})
                return {
                    'url': data.get('clip_url'),
                    'title': data.get('title') or "Kick Clip",
                    'channel': data.get('channel', {}).get('slug') if isinstance(data.get('channel'), dict) else "Kick",
                    'thumbnail': data.get('thumbnail_url'),
                    'duration': data.get('duration'),
                }
        except Exception as e:
            print(f"Kick clip API error: {e}")

    elif channel_match:
        channel_slug = channel_match.group(1)
        try:
            api_url = f"https://kick.com/api/v2/channels/{channel_slug}"
            resp = client.get(api_url, **req_kwargs)
            if resp.status_code == 200:
                data = resp.json()
                playback_url = data.get('playback_url')
                if playback_url:
                    ls = data.get('livestream') or {}
                    return {
                        'url': playback_url,
                        'title': ls.get('session_title') or f"Kick Live - {channel_slug}",
                        'channel': channel_slug,
                        'thumbnail': (ls.get('thumbnail') or {}).get('url'),
                        'duration': None,
                        'is_live': True,
                    }
        except Exception as e:
            print(f"Kick live API error: {e}")

    return None


# ── Extraccion de info del video ──────────────────────────────────────────────

def fetch_video_info(
    url: str,
    platform: str = "auto",
    cookie_browser: Optional[str] = None,
    cookie_file: Optional[str] = None,
) -> dict:
    """
    Extrae metadatos del video sin descargar.

    Parametros
    ----------
    url             : URL del video.
    platform        : 'auto' | 'youtube' | 'tiktok' | 'instagram' | 'kick'
    cookie_browser  : nombre de navegador ('chrome', 'firefox', etc.) o None.
    cookie_file     : ruta a archivo cookies.txt, o None.

    Devuelve el dict de info de yt-dlp, con clave extra '_stream_url' para Kick.
    Lanza Exception si falla.
    """
    plat = platform if platform != "auto" else detect_platform(url)

    js_runtimes = _detect_js_runtimes()
    ydl_opts = {
        "quiet":         True,
        "no_warnings":   True,
        "skip_download": True,
        "http_headers":  HTTP_HEADERS,
    }
    if js_runtimes:
        ydl_opts["js_runtimes"] = js_runtimes

    # Cookies
    if plat != "kick":
        if cookie_file:
            ydl_opts["cookiefile"] = cookie_file
        elif cookie_browser:
            ydl_opts["cookiesfrombrowser"] = (cookie_browser,)

    if plat == "kick":
        kick_data = resolve_kick_video(url)
        if not kick_data or not kick_data.get("url"):
            raise Exception("No se pudo obtener el stream de Kick. Verifica que el video o canal sea publico.")
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(kick_data["url"], download=False)
        info["title"]       = kick_data.get("title")     or info.get("title")    or "Kick Video"
        info["channel"]     = kick_data.get("channel")   or info.get("uploader") or ""
        info["_stream_url"] = kick_data["url"]
        if kick_data.get("thumbnail"):
            info["thumbnail"] = kick_data["thumbnail"]
        if kick_data.get("duration"):
            info["duration"] = kick_data["duration"]
    else:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)

    return info


def get_available_qualities(info: dict) -> list:
    """
    Devuelve lista de calidades disponibles (ej. ['360p', '720p', '1080p', 'Mejor disponible']).
    """
    def _extract_height(f: dict):
        if f.get("vcodec") in (None, "none"):
            return None
        h = f.get("height")
        if h:
            return int(h)
        note = f.get("format_note") or ""
        m = re.match(r"(\d{3,4})p", note)
        if m:
            return int(m.group(1))
        res = f.get("resolution") or ""
        parts = res.split("x")
        if len(parts) == 2 and parts[1].isdigit():
            return int(parts[1])
        return None

    formats   = info.get("formats", [])
    available = set()
    for f in formats:
        h = _extract_height(f)
        if h:
            available.add(h)
    max_h     = max(available) if available else 0
    filtered  = [h for h in STANDARD_HEIGHTS if h <= max_h]
    extra     = sorted(available - set(STANDARD_HEIGHTS))
    all_heights = sorted(set(filtered) | set(extra))
    q_opts = [f"{h}p" for h in all_heights]
    q_opts.append("Mejor disponible")
    return q_opts


# ── Descarga ──────────────────────────────────────────────────────────────────

def build_ydl_opts(
    *,
    url: str,
    platform: str,
    quality: str,
    audio_only: bool,
    audio_bitrate: str,
    download_dir: str,
    video_title: Optional[str],
    cookie_browser: Optional[str],
    cookie_file: Optional[str],
    progress_hook: Callable,
    video_info: Optional[dict] = None,
) -> tuple:
    """
    Construye el dict de opciones para yt_dlp.YoutubeDL y devuelve
    (ydl_opts, download_url).
    """
    plat         = platform if platform != "auto" else detect_platform(url)
    download_url = url

    if plat == "kick" and video_info and video_info.get("_stream_url"):
        download_url = video_info["_stream_url"]

    # Seleccion de formato
    if audio_only:
        fmt = "bestaudio/best"
    elif plat in ("youtube", "kick", "facebook"):
        if quality == "Mejor disponible":
            fmt = "bestvideo+bestaudio/best"
        elif quality.endswith("p") and quality[:-1].isdigit():
            h   = quality[:-1]
            fmt = f"bestvideo[height<={h}]+bestaudio/best[height<={h}]/best[height<={h}]"
        else:
            fmt = "bestvideo+bestaudio/best"
    else:
        fmt = "bestvideo+bestaudio/best"

    # Plantilla de nombre de archivo
    if video_title and video_title != "%(title)s":
        clean = re.sub(r'[\\/*?:"<>|]', "", video_title).strip()
        outtmpl = os.path.join(download_dir, f"{clean}.%(ext)s")
    else:
        outtmpl = os.path.join(download_dir, "%(title)s.%(ext)s")

    js_runtimes = _detect_js_runtimes()
    ydl_opts = {
        "format":              fmt,
        "outtmpl":             outtmpl,
        "progress_hooks":      [progress_hook],
        "merge_output_format": "mp4",
        "quiet":               True,
        "no_warnings":         True,
        "http_headers":        HTTP_HEADERS,
        "nocheckcertificate":  False,
        "socket_timeout":      30,
    }
    if js_runtimes:
        ydl_opts["js_runtimes"] = js_runtimes

    # Cookies
    if plat != "kick":
        if cookie_file:
            ydl_opts["cookiefile"] = cookie_file
        elif cookie_browser:
            ydl_opts["cookiesfrombrowser"] = (cookie_browser,)

    if audio_only:
        ydl_opts["postprocessors"] = [{
            "key":              "FFmpegExtractAudio",
            "preferredcodec":   "mp3",
            "preferredquality": audio_bitrate,
        }]

    return ydl_opts, download_url


def download_video(
    url: str,
    *,
    platform: str = "auto",
    quality: str = "Mejor disponible",
    audio_only: bool = False,
    audio_bitrate: str = "192",
    download_dir: Optional[str] = None,
    cookie_browser: Optional[str] = None,
    cookie_file: Optional[str] = None,
    progress_hook: Callable,
    video_info: Optional[dict] = None,
) -> None:
    """
    Ejecuta la descarga completa.

    Parametros
    ----------
    url            : URL del video.
    platform       : 'auto' | 'youtube' | 'tiktok' | 'instagram' | 'kick'.
    quality        : Ej. '1080p', '720p', 'Mejor disponible'.
    audio_only     : Si True, descarga solo MP3.
    audio_bitrate  : Bitrate de audio ('128', '192', '320', ...).
    download_dir   : Directorio de destino (default: ~/Downloads/YT-Downloader).
    cookie_browser : 'chrome' | 'firefox' | 'edge' | 'brave' | 'opera' | None.
    cookie_file    : Ruta a cookies.txt, o None.
    progress_hook  : Callable que recibe el dict de progreso de yt-dlp.
    video_info     : Info previa de fetch_video_info (opcional, para Kick).
    """
    if download_dir is None:
        download_dir = get_downloads_dir()

    video_title = video_info.get("title") if video_info else None

    ydl_opts, download_url = build_ydl_opts(
        url=url,
        platform=platform,
        quality=quality,
        audio_only=audio_only,
        audio_bitrate=audio_bitrate,
        download_dir=download_dir,
        video_title=video_title,
        cookie_browser=cookie_browser,
        cookie_file=cookie_file,
        progress_hook=progress_hook,
        video_info=video_info,
    )

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([download_url])
