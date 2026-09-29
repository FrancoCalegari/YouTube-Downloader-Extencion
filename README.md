# Multi Downloader — GaboDev

> Descarga videos y audio de YouTube, TikTok, Instagram y Kick.  
> Disponible como **interfaz gráfica** (`main.py`) o **línea de comandos** (`cli.py`).  
> Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) · Desarrollado con Python + CustomTkinter

---

## ✨ Características

| Función | Descripción |
|---|---|
| 📥 Descarga de video | MP4 en la calidad que elijas (hasta 4K según disponibilidad) |
| 🎵 Descarga de audio | Extrae el audio en MP3 con bitrate configurable (64k – 320k) |
| 🌐 Multi-plataforma | YouTube, YouTube Music, TikTok, Instagram Reels, Kick VODs/clips/live |
| 🔍 Vista previa | Muestra miniatura, título, canal y duración antes de descargar |
| 📊 Progreso en tiempo real | Barra con velocidad y tiempo restante (GUI y terminal) |
| 📁 Carpeta personalizable | Elige dónde guardar los archivos |
| 🍪 Soporte de cookies | Autenticación via Chrome, Firefox, Edge, Brave, Opera o archivo `.txt` |
| 💻 Modo CLI | Descarga directamente desde la terminal sin abrir la GUI |

---

## 🖥️ Modos de uso

### Interfaz gráfica

```bash
python main.py
```

### Línea de comandos (CLI)

```bash
# Descarga básica (mejor calidad disponible)
python cli.py https://www.youtube.com/watch?v=VIDEO_ID

# Solo audio MP3
python cli.py https://youtu.be/VIDEO_ID --audio

# Resolución específica
python cli.py https://youtu.be/VIDEO_ID -r 720p

# Ver calidades disponibles sin descargar
python cli.py https://youtu.be/VIDEO_ID --list-qualities

# Solo mostrar info del video
python cli.py https://youtu.be/VIDEO_ID --info-only

# Guardar en carpeta personalizada
python cli.py https://youtu.be/VIDEO_ID -o ~/Videos

# Con cookies de navegador (Instagram, contenido privado)
python cli.py https://www.instagram.com/reel/... -b firefox

# Con archivo cookies.txt exportado
python cli.py https://youtu.be/VIDEO_ID -c cookies.txt

# Kick VOD
python cli.py https://kick.com/canal/videos/VIDEO_ID

# Forzar plataforma
python cli.py https://... -p kick
```

#### Referencia de opciones CLI

| Opción | Descripción | Default |
|---|---|---|
| `url` | URL del video (requerido) | — |
| `-a`, `--audio` | Descargar solo audio (MP3) | off |
| `-r`, `--resolution` | Calidad: `1080p`, `720p`, `480p`… | Mejor disponible |
| `-q`, `--audio-quality` | Bitrate MP3: `128`, `192`, `256`, `320` | `192` |
| `-o`, `--output` | Directorio de destino | `~/Downloads/YT-Downloader` |
| `-p`, `--platform` | `auto`, `youtube`, `tiktok`, `instagram`, `kick` | `auto` |
| `-b`, `--cookie-browser` | `chrome`, `firefox`, `edge`, `brave`, `opera` | ninguno |
| `-c`, `--cookie-file` | Ruta a archivo `cookies.txt` | ninguno |
| `--list-qualities` | Listar calidades disponibles y salir | — |
| `--info-only` | Mostrar info del video sin descargar | — |

---

## 📡 Plataformas soportadas

| Plataforma | URLs admitidas |
|---|---|
| YouTube | `youtube.com/watch`, `youtu.be`, `youtube.com/shorts`, `music.youtube.com` |
| TikTok | `tiktok.com/@user/video/...`, `vm.tiktok.com/...` |
| Instagram | `instagram.com/reel/...`, `instagram.com/p/...` |
| Kick | VODs, clips y streams en vivo |

---

## ⚙️ Requisitos del sistema

- **Python** 3.10 o superior
- **FFmpeg** instalado y disponible en el PATH (necesario para mezclar video + audio y convertir a MP3)
  - Linux: `sudo apt install ffmpeg` / `sudo pacman -S ffmpeg`
  - macOS: `brew install ffmpeg`
  - Windows: [ffmpeg.org/download.html](https://ffmpeg.org/download.html) o `winget install ffmpeg`

---

## 🚀 Instalación

### 1. Clonar el repositorio

```bash
git clone https://github.com/TU_USUARIO/multi-downloader.git
cd multi-downloader
```

### 2. Crear un entorno virtual (recomendado)

```bash
python -m venv .venv

# Windows
.venv\Scripts\activate

# Linux / macOS
source .venv/bin/activate
```

### 3. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 4. Ejecutar

```bash
# Interfaz gráfica
python main.py

# Terminal
python cli.py --help
```

---

## 📦 Dependencias

| Paquete | Uso |
|---|---|
| `yt-dlp` | Motor de descarga |
| `customtkinter` | Interfaz gráfica moderna |
| `Pillow` | Procesamiento de miniaturas |
| `requests` | Descarga de miniaturas por HTTP |
| `curl_cffi` *(opcional)* | Soporte mejorado para Kick (TLS fingerprinting) |

```bash
pip install -r requirements.txt
```

---

## 📂 Estructura del proyecto

```
multi-downloader/
├── main.py          # Interfaz gráfica (GUI) — punto de entrada principal
├── cli.py           # Interfaz de línea de comandos (CLI)
├── core.py          # Motor de descarga compartido (lógica pura, sin UI)
├── requirements.txt # Dependencias de Python
├── DESIGN.md        # Sistema de diseño (tokens, paleta, componentes)
├── .gitignore
└── README.md
```

> `core.py` contiene toda la lógica de descarga. Tanto `main.py` (GUI) como `cli.py` (terminal) lo importan, evitando duplicación de código.

---

## 🎨 Sistema de diseño

La interfaz sigue el **Design System Táctico** documentado en [`DESIGN.md`](./DESIGN.md):

| Token | Valor |
|---|---|
| Acento principal | `#A30000` (rojo táctico) |
| Fondo | `#000000` |
| Superficie | `#121212` |
| Texto principal | `#F5F5F5` |
| Estado OK | `#22c55e` |
| Estado error | `#A30000` |
| Tipografía | Courier New (monoespaciada) |

---

## 🛠️ Tecnologías utilizadas

| Tecnología | Uso |
|---|---|
| [Python 3.10+](https://python.org) | Lenguaje principal |
| [CustomTkinter](https://github.com/TomSchimansky/CustomTkinter) | Interfaz gráfica moderna |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Motor de descarga |
| [Pillow](https://python-pillow.org) | Procesamiento de imágenes |
| [Requests](https://docs.python-requests.org) | Peticiones HTTP |
| [FFmpeg](https://ffmpeg.org) | Procesamiento de audio/video |
| [curl_cffi](https://github.com/yifeikong/curl_cffi) | Evasión de Cloudflare (Kick) |

---

## ❓ Preguntas frecuentes

**¿Por qué necesito FFmpeg?**  
yt-dlp descarga el video y el audio por separado en alta calidad, y FFmpeg los combina en un único archivo MP4. Para MP3, FFmpeg extrae el audio del stream descargado.

**¿Funciona con YouTube Shorts?**  
Sí, el programa admite URLs de tipo `youtube.com/shorts/...`.

**¿Puedo descargar listas de reproducción (playlists)?**  
No actualmente. El programa está diseñado para videos individuales.

**¿Para qué sirven las cookies?**  
Algunos contenidos (Instagram Reels privados, videos con edad restringida) requieren que estés autenticado. Puedes usar las cookies de tu navegador con `-b firefox` o `-b chrome`, o exportar un archivo `cookies.txt` con una extensión del navegador.

**¿Kick necesita cookies?**  
No. Los VODs y clips públicos de Kick se descargan sin autenticación.

**¿Cómo uso el CLI sin activar el venv cada vez?**  
Activa el venv una vez por sesión de terminal: `source .venv/bin/activate`. Luego puedes usar `python cli.py` directamente.

---

## 📄 Licencia

Este proyecto se distribua bajo la licencia **MIT**.  
Úsalo, modifícalo y compártelo libremente.

---

<div align="center">
  Desarrollado con ♥ por <strong>GaboDev</strong>
</div>
