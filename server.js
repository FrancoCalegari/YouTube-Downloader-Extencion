import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env variables natively
try {
  process.loadEnvFile();
  console.log('📄 Variables de entorno cargadas correctamente desde .env');
} catch (e) {
  if (e.code !== 'ENOENT') {
    console.warn('⚠️ Advertencia leyendo .env:', e.message);
  }
}

// Configuration
const PORT = parseInt(process.env.PORT, 10) || 23458;
const DOWNLOADS_DIR = path.resolve(__dirname, process.env.DOWNLOADS_DIR || 'downloads');
const DEBUG = process.env.DEBUG === 'true' || process.env.DEBUG === '1';
const DEBUG_LEVEL = (process.env.DEBUG_LEVEL || 'verbose').toLowerCase();
const PLAYER_CLIENTS = process.env.YTDLP_PLAYER_CLIENTS || 'android,ios,web';
const COOKIES_BROWSER = process.env.YTDLP_COOKIES_BROWSER || null;
const COOKIE_FILE = process.env.YTDLP_COOKIE_FILE || null;

// File Retention TTL (10 minutes default)
const FILE_TTL_MINUTES = parseInt(process.env.FILE_TTL_MINUTES, 10) || 10;
const FILE_TTL_MS = FILE_TTL_MINUTES * 60 * 1000;

// Ensure downloads folder exists
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

// -------------------------------------------------------------
// Debug Logger & In-Memory Ring Buffer
// -------------------------------------------------------------
const MAX_LOGS = 250;
const debugLogs = [];

function addLog(level, tag, message, details = null) {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 23);
  const logEntry = {
    id: crypto.randomUUID(),
    timestamp,
    level,
    tag,
    message,
    details
  };

  debugLogs.push(logEntry);
  if (debugLogs.length > MAX_LOGS) {
    debugLogs.shift();
  }

  // Console output
  const levelBadge = {
    debug: '\x1b[36m[DEBUG]\x1b[0m',
    info: '\x1b[32m[INFO]\x1b[0m',
    warn: '\x1b[33m[WARN]\x1b[0m',
    error: '\x1b[31m[ERROR]\x1b[0m'
  }[level] || `[${level.toUpperCase()}]`;

  const tagBadge = `\x1b[35m[${tag}]\x1b[0m`;

  if (level === 'debug') {
    if (DEBUG) {
      console.log(`${timestamp} ${levelBadge} ${tagBadge} ${message}`);
      if (details) console.log('   ↳ Details:', details);
    }
  } else {
    console.log(`${timestamp} ${levelBadge} ${tagBadge} ${message}`);
    if (details) console.log('   ↳ Details:', details);
  }
}

const logger = {
  debug: (tag, msg, details) => addLog('debug', tag, msg, details),
  info: (tag, msg, details) => addLog('info', tag, msg, details),
  warn: (tag, msg, details) => addLog('warn', tag, msg, details),
  error: (tag, msg, details) => addLog('error', tag, msg, details)
};

// Express App
const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Request logger middleware (when DEBUG is true)
app.use((req, res, next) => {
  if (DEBUG && !req.path.startsWith('/api/progress') && req.path !== '/api/debug/logs') {
    logger.debug('HTTP', `${req.method} ${req.url}`);
  }
  next();
});

// In-memory store for download jobs and cache
const jobs = new Map();
const infoCache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function sanitizeFileName(name) {
  return (name || 'download')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .trim()
    .slice(0, 180);
}

function formatDuration(seconds) {
  if (!seconds || isNaN(seconds)) return '0:00';
  const sec = Math.floor(seconds);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
  }
  return `${mins}:${remSec.toString().padStart(2, '0')}`;
}

function isYouTubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  return /^(https?:\/\/)?((www|music|m)\.)?(youtube\.com\/(watch\?|shorts\/|embed\/)|youtu\.be\/)/i.test(rawUrl.trim());
}

function isInstagramUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  return /^(https?:\/\/)?((www)\.)?(instagram\.com\/(p|reel|reels|stories)\/|instagr\.am\/)/i.test(rawUrl.trim());
}

function isFacebookUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  return /^(https?:\/\/)?((www|m|web)\.)?(facebook\.com\/(watch|reel|reels|share|.*videos?|video\.php)|fb\.watch\/)/i.test(rawUrl.trim());
}

function isValidVideoUrl(rawUrl) {
  return isYouTubeUrl(rawUrl) || isInstagramUrl(rawUrl) || isFacebookUrl(rawUrl);
}

// Build standard yt-dlp arguments with anti-403 configuration
function buildBaseYtdlpArgs(targetUrl = '') {
  const args = [
    '--js-runtimes', 'node',
    '--no-warnings',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
  ];

  if (isYouTubeUrl(targetUrl)) {
    args.push('--extractor-args', `youtube:player_client=${PLAYER_CLIENTS}`);
  }

  if (COOKIE_FILE && fs.existsSync(COOKIE_FILE)) {
    args.push('--cookies', COOKIE_FILE);
    logger.debug('CONFIG', `Usando archivo de cookies: ${COOKIE_FILE}`);
  } else if (COOKIES_BROWSER) {
    args.push('--cookies-from-browser', COOKIES_BROWSER);
    logger.debug('CONFIG', `Usando cookies de navegador: ${COOKIES_BROWSER}`);
  }

  return args;
}

// Broadcast job update to all connected SSE clients
function notifyJobListeners(job) {
  if (!job.listeners || job.listeners.size === 0) return;
  const payload = JSON.stringify({
    jobId: job.id,
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    stageMessage: job.stageMessage,
    downloadUrl: job.status === 'ready' ? `/api/download/${job.id}/file` : null,
    fileName: job.fileName,
    error: job.error || null,
    debugMode: DEBUG
  });

  for (const res of job.listeners) {
    try {
      res.write(`data: ${payload}\n\n`);
      if (['ready', 'error', 'cancelled'].includes(job.status)) {
        res.end();
      }
    } catch {
      job.listeners.delete(res);
    }
  }
}

// -------------------------------------------------------------
// Auto-cleanup & TTL Manager (10 minutes retention)
// -------------------------------------------------------------
function scheduleJobCleanup(job) {
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);

  job.cleanupTimer = setTimeout(() => {
    deleteJobFile(job, `Tiempo de vida (${FILE_TTL_MINUTES} min) cumplido`);
  }, FILE_TTL_MS);
}

function deleteJobFile(job, reason = 'Expirado') {
  try {
    if (job.filePath && fs.existsSync(job.filePath)) {
      const fileName = path.basename(job.filePath);
      fs.unlinkSync(job.filePath);
      logger.info('CLEANUP', `[Job ${job.id.slice(0, 8)}] Archivo eliminado (${reason}): "${fileName}"`);
    }
  } catch (err) {
    logger.error('CLEANUP', `Error al eliminar archivo del trabajo ${job.id}:`, err.message);
  } finally {
    job.status = 'expired';
    job.filePath = null;
    job.stageMessage = `Archivo expirado tras ${FILE_TTL_MINUTES} minutos.`;
    notifyJobListeners(job);
  }
}

// Periodic sweeper for orphaned/expired files (> 10 min)
function runStorageSweeper() {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) return;
    const now = Date.now();
    const files = fs.readdirSync(DOWNLOADS_DIR);

    for (const file of files) {
      if (file.startsWith('.')) continue; // ignore .gitkeep
      const fullPath = path.join(DOWNLOADS_DIR, file);
      try {
        const stats = fs.statSync(fullPath);
        if (stats.isFile() && (now - stats.mtimeMs) > FILE_TTL_MS) {
          fs.unlinkSync(fullPath);
          logger.info('SWEEPER', `Archivo expirado (> ${FILE_TTL_MINUTES}m) eliminado: "${file}"`);

          const jobIdPrefix = file.split('.')[0];
          const matchedJob = jobs.get(jobIdPrefix);
          if (matchedJob && matchedJob.status === 'ready') {
            matchedJob.status = 'expired';
            matchedJob.filePath = null;
            matchedJob.stageMessage = `Archivo expirado tras ${FILE_TTL_MINUTES} minutos.`;
            notifyJobListeners(matchedJob);
          }
        }
      } catch {
        // file may have been unlinked concurrently
      }
    }
  } catch (err) {
    logger.error('SWEEPER', 'Error durante la limpieza periódica:', err.message);
  }
}

// Run sweeper on startup and periodically every 60 seconds
runStorageSweeper();
setInterval(runStorageSweeper, 60 * 1000);

// -------------------------------------------------------------
// 1. Health check & system diagnostics
// -------------------------------------------------------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    debugMode: DEBUG,
    debugLevel: DEBUG_LEVEL,
    playerClients: PLAYER_CLIENTS,
    fileTtlMinutes: FILE_TTL_MINUTES,
    timestamp: new Date().toISOString(),
    downloadsCount: fs.existsSync(DOWNLOADS_DIR) ? fs.readdirSync(DOWNLOADS_DIR).length : 0,
    activeJobs: Array.from(jobs.values()).filter(j => ['queued', 'downloading', 'converting'].includes(j.status)).length
  });
});

// -------------------------------------------------------------
// 2. Debug Logs Endpoint (Used by Extension & Developer)
// -------------------------------------------------------------
app.get('/api/debug/logs', (req, res) => {
  const limit = parseInt(req.query.limit, 10) || 50;
  res.json({
    debug: DEBUG,
    level: DEBUG_LEVEL,
    playerClients: PLAYER_CLIENTS,
    count: debugLogs.length,
    logs: debugLogs.slice(-limit)
  });
});

app.post('/api/debug/clear', (req, res) => {
  debugLogs.length = 0;
  logger.info('DEBUG', 'Buffer de registros de depuración limpiado.');
  res.json({ success: true });
});

// -------------------------------------------------------------
// 3. Fetch video metadata & available formats
// -------------------------------------------------------------
app.get('/api/info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ error: 'Falta el parámetro "url".' });
  }

  if (!isValidVideoUrl(videoUrl)) {
    return res.status(400).json({ error: 'URL no válida. Debe ser un enlace de YouTube, Instagram o Facebook válido.' });
  }

  logger.info('INFO', `Consultando metadatos para: ${videoUrl}`);

  // Check cache
  const cached = infoCache.get(videoUrl);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    logger.debug('CACHE', `Retornando metadatos desde caché para: ${videoUrl}`);
    return res.json(cached.data);
  }

  try {
    const args = [
      ...buildBaseYtdlpArgs(videoUrl),
      '--dump-single-json',
      '--no-playlist',
      videoUrl.trim()
    ];

    logger.debug('YTDLP', `Ejecutando: yt-dlp ${args.join(' ')}`);

    const cp = spawn('yt-dlp', args);
    let stdoutData = '';
    let stderrData = '';

    cp.stdout.on('data', (d) => { stdoutData += d.toString(); });
    cp.stderr.on('data', (d) => { stderrData += d.toString(); });

    cp.on('close', (code) => {
      if (code !== 0) {
        logger.error('YTDLP', `Error extrayendo información (código ${code})`, stderrData);
        let userMessage = 'No se pudo obtener información del video.';
        if (stderrData.includes('403: Forbidden')) {
          userMessage = 'La plataforma bloqueó la solicitud (HTTP 403 Forbidden). Los clientes alternativos o cookies se activarán al descargar.';
        } else if (stderrData.includes('Sign in to confirm') || stderrData.includes('Log in to Facebook')) {
          userMessage = 'El video requiere inicio de sesión. Configura cookies en .env (YTDLP_COOKIES_BROWSER).';
        }

        return res.status(500).json({
          error: userMessage,
          details: stderrData.slice(-400)
        });
      }

      try {
        const raw = JSON.parse(stdoutData);

        const formats = raw.formats || [];
        const heights = new Set();
        for (const f of formats) {
          if (f.vcodec && f.vcodec !== 'none' && f.height) {
            heights.add(f.height);
          }
        }

        const standardHeights = [2160, 1440, 1080, 720, 480, 360, 240, 144];
        let availableHeights = standardHeights.filter(h => heights.has(h));
        if (availableHeights.length === 0 && heights.size > 0) {
          availableHeights.push(...Array.from(heights).sort((a, b) => b - a));
        }

        // Fallback para Facebook si los formatos no declaran height pero indican hd/sd
        if (availableHeights.length === 0 && isFacebookUrl(videoUrl)) {
          const hasHd = formats.some(f => (f.format_note && f.format_note.toLowerCase().includes('hd')) || (f.format_id && f.format_id.includes('hd')));
          const hasSd = formats.some(f => (f.format_note && f.format_note.toLowerCase().includes('sd')) || (f.format_id && f.format_id.includes('sd')));
          if (hasHd) availableHeights.push(720);
          if (hasSd) availableHeights.push(480);
        }

        const videoQualities = [
          { id: 'best', label: 'Mejor disponible (Auto)' },
          ...availableHeights.map(h => ({
            id: `${h}p`,
            label: h >= 2160 ? `${h}p (4K UHD)` : h >= 1440 ? `${h}p (2K QHD)` : h >= 1080 ? `${h}p (Full HD)` : h >= 720 ? `${h}p (HD)` : `${h}p (SD)`
          }))
        ];

        const audioQualities = [
          { id: '320k', label: '320 kbps (Máxima fidelidad)' },
          { id: '256k', label: '256 kbps (Muy alta)' },
          { id: '192k', label: '192 kbps (Estándar recomendada)' },
          { id: '128k', label: '128 kbps (Ligero)' },
          { id: '64k', label: '64 kbps (Voz / Podcasts)' }
        ];

        const audioFormats = [
          { id: 'mp3', label: 'MP3 (Universal, más compatible)' },
          { id: 'm4a', label: 'M4A (Excelente calidad AAC)' },
          { id: 'wav', label: 'WAV (Sin compresión)' },
          { id: 'flac', label: 'FLAC (Lossless / Audiofilo)' },
          { id: 'opus', label: 'OPUS (Máxima eficiencia)' }
        ];

        const videoFormats = [
          { id: 'mp4', label: 'MP4 (Universal H.264 / AAC)' },
          { id: 'webm', label: 'WEBM (VP9 / Opus)' },
          { id: 'mkv', label: 'MKV (Matroska alta calidad)' }
        ];

        const defaultTitle = isFacebookUrl(videoUrl)
          ? `Facebook Video ${raw.id || ''}`
          : (isInstagramUrl(videoUrl) ? `Instagram Reel ${raw.id || ''}` : 'Video de YouTube');
        const defaultUploader = isFacebookUrl(videoUrl)
          ? 'Facebook'
          : (isInstagramUrl(videoUrl) ? 'Instagram' : 'Desconocido');
        const defaultThumb = raw.thumbnail || (raw.thumbnails && raw.thumbnails.length > 0 ? raw.thumbnails[raw.thumbnails.length - 1].url : '') || (isYouTubeUrl(videoUrl) ? `https://i.ytimg.com/vi/${raw.id}/hqdefault.jpg` : '');

        const responseData = {
          id: raw.id,
          title: raw.title || defaultTitle,
          uploader: raw.uploader || raw.channel || defaultUploader,
          channelUrl: raw.channel_url || raw.uploader_url || '',
          duration: raw.duration || 0,
          durationFormatted: formatDuration(raw.duration),
          thumbnail: defaultThumb,
          viewCount: raw.view_count || 0,
          videoQualities,
          videoFormats,
          audioQualities,
          audioFormats,
          url: videoUrl
        };

        infoCache.set(videoUrl, { timestamp: Date.now(), data: responseData });
        logger.info('INFO', `Metadatos obtenidos exitosamente: "${responseData.title}"`);
        res.json(responseData);
      } catch (err) {
        logger.error('JSON', 'Error procesando JSON de yt-dlp', err.message);
        res.status(500).json({ error: 'Error procesando respuesta del video.' });
      }
    });
  } catch (error) {
    logger.error('SERVER', 'Error en endpoint /api/info', error.message);
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// 4. Initiate video or audio download
// -------------------------------------------------------------
app.post('/api/download', (req, res) => {
  const { url, type = 'video', format = 'mp4', quality = 'best', title } = req.body;

  if (!url || !isValidVideoUrl(url)) {
    return res.status(400).json({ error: 'URL no válida.' });
  }

  const jobId = crypto.randomUUID();
  const isAudio = type === 'audio';
  const targetExt = isAudio ? (format || 'mp3') : (format || 'mp4');
  const safeTitle = sanitizeFileName(title || 'video');
  const outTemplate = path.join(DOWNLOADS_DIR, `${jobId}.%(ext)s`);

  // Build command arguments
  const args = [
    ...buildBaseYtdlpArgs(url),
    '--newline',
    '--progress-template', 'PROGRESS:%(progress._percent_str)s|%(progress._speed_str)s|%(progress._eta_str)s|%(progress.status)s|%(progress.total_bytes_estimate_str)s',
    '--no-playlist'
  ];

  if (isAudio) {
    // Robust audio format specification that works across all YouTube clients
    args.push('-f', 'ba/b');
    args.push('-x');
    args.push('--audio-format', targetExt);
    const audioBitrate = (quality || '192k').replace(/k$/i, '') + 'K';
    args.push('--audio-quality', audioBitrate);
  } else {
    // Video format specification
    let formatFilter = 'bestvideo+bestaudio/best';
    if (quality && quality !== 'best' && quality !== 'Mejor disponible') {
      const height = quality.replace(/\D/g, '');
      if (height) {
        formatFilter = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best[height<=${height}]`;
      }
    }
    args.push('-f', formatFilter);
    args.push('--merge-output-format', targetExt);
  }

  args.push('-o', outTemplate);
  args.push(url.trim());

  logger.info('DOWNLOAD', `[Job ${jobId}] Iniciando descarga de ${type.toUpperCase()}`, {
    format: targetExt,
    quality,
    url: url.trim(),
    title: safeTitle
  });

  if (DEBUG) {
    logger.debug('COMMAND', `yt-dlp ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`);
  }

  // Job state object
  const job = {
    id: jobId,
    url,
    type,
    format: targetExt,
    quality,
    title: title || 'Descargando video...',
    fileName: `${safeTitle}.${targetExt}`,
    status: 'queued',
    percent: 0,
    speed: '--',
    eta: '--',
    stageMessage: 'Iniciando conexión con los servidores de YouTube...',
    filePath: null,
    fileSize: null,
    error: null,
    createdAt: Date.now(),
    listeners: new Set(),
    childProcess: null
  };

  jobs.set(jobId, job);

  // Spawn yt-dlp
  const startTime = Date.now();
  const cp = spawn('yt-dlp', args);
  job.childProcess = cp;

  let stderrLog = '';

  cp.stdout.on('data', (chunk) => {
    const lines = chunk.toString().split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (DEBUG && DEBUG_LEVEL === 'verbose' && !trimmed.startsWith('PROGRESS:')) {
        logger.debug('YTDLP-OUT', `[Job ${jobId.slice(0, 8)}] ${trimmed}`);
      }

      if (trimmed.startsWith('PROGRESS:')) {
        const parts = trimmed.slice(9).split('|');
        const pctRaw = parts[0]?.replace('%', '').trim();
        const speed = parts[1]?.trim() || '--';
        const eta = parts[2]?.trim() || '--';

        const percent = parseFloat(pctRaw);
        if (!isNaN(percent)) {
          job.percent = Math.min(100, Math.max(0, percent));
        }
        job.speed = speed !== 'Unknown B/s' ? speed : '--';
        job.eta = eta !== 'Unknown' ? eta : '--';
        job.status = 'downloading';
        job.stageMessage = isAudio
          ? `Descargando audio... ${job.percent.toFixed(1)}%`
          : `Descargando video... ${job.percent.toFixed(1)}%`;

        notifyJobListeners(job);
      } else if (trimmed.includes('[ExtractAudio]')) {
        job.status = 'converting';
        job.stageMessage = `Extrayendo y convirtiendo a ${targetExt.toUpperCase()} con FFmpeg...`;
        job.percent = 95;
        logger.info('CONVERT', `[Job ${jobId.slice(0, 8)}] Convirtiendo audio a ${targetExt.toUpperCase()}`);
        notifyJobListeners(job);
      } else if (trimmed.includes('[Merger]')) {
        job.status = 'converting';
        job.stageMessage = 'Uniendo pistas de video y audio con FFmpeg...';
        job.percent = 95;
        logger.info('CONVERT', `[Job ${jobId.slice(0, 8)}] Uniendo audio y video en contenedor ${targetExt.toUpperCase()}`);
        notifyJobListeners(job);
      } else if (trimmed.includes('[VideoConvertor]')) {
        job.status = 'converting';
        job.stageMessage = `Convirtiendo video a ${targetExt.toUpperCase()}...`;
        notifyJobListeners(job);
      }
    }
  });

  cp.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    stderrLog += text;
    if (DEBUG) {
      logger.debug('YTDLP-ERR', `[Job ${jobId.slice(0, 8)}] ${text.trim()}`);
    }
  });

  cp.on('close', (code) => {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    job.childProcess = null;

    if (code === 0) {
      // Find output file
      const files = fs.readdirSync(DOWNLOADS_DIR);
      const matched = files.find(f => f.startsWith(jobId));

      if (matched) {
        job.filePath = path.join(DOWNLOADS_DIR, matched);
        const stats = fs.statSync(job.filePath);
        job.fileSize = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
      }

      job.status = 'ready';
      job.percent = 100;
      job.completedAt = Date.now();
      job.expiresAt = Date.now() + FILE_TTL_MS;
      job.stageMessage = '¡Descarga y conversión completadas con éxito!';
      logger.info('SUCCESS', `[Job ${jobId}] Finalizado en ${elapsed}s -> ${job.fileName} (${job.fileSize}) [Expira en ${FILE_TTL_MINUTES} min]`);
      scheduleJobCleanup(job);
    } else {
      if (job.status !== 'cancelled') {
        job.status = 'error';

        // Provide smart diagnostics for common YouTube issues
        let friendlyError = 'Error durante la descarga.';
        if (stderrLog.includes('HTTP Error 403: Forbidden')) {
          friendlyError = 'Error 403 (Forbidden): YouTube bloqueó la petición. Los clientes alternativos ya fueron configurados en .env.';
        } else if (stderrLog.includes('Sign in to confirm')) {
          friendlyError = 'Este video requiere autenticación. Activa YTDLP_COOKIES_BROWSER en .env.';
        } else {
          friendlyError = stderrLog.split('\n').filter(l => l.includes('ERROR:')).pop() || 'Error procesando la descarga.';
        }

        job.error = friendlyError;
        job.stageMessage = 'Error en la descarga';
        logger.error('FAILURE', `[Job ${jobId}] Falló tras ${elapsed}s (código ${code})`, friendlyError);
      }
    }
    notifyJobListeners(job);
  });

  res.status(202).json({
    jobId,
    status: 'queued',
    title: job.title,
    format: targetExt,
    quality,
    debug: DEBUG
  });
});

// -------------------------------------------------------------
// 5. Server-Sent Events (SSE) for real-time progress
// -------------------------------------------------------------
app.get('/api/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Trabajo no encontrado.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  res.write('\n');

  // Immediately send initial state
  const payload = JSON.stringify({
    jobId: job.id,
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    stageMessage: job.stageMessage,
    downloadUrl: job.status === 'ready' ? `/api/download/${job.id}/file` : null,
    fileName: job.fileName,
    error: job.error || null,
    debugMode: DEBUG
  });
  res.write(`data: ${payload}\n\n`);

  if (['ready', 'error', 'cancelled'].includes(job.status)) {
    res.end();
    return;
  }

  job.listeners.add(res);

  req.on('close', () => {
    job.listeners.delete(res);
  });
});

// -------------------------------------------------------------
// 6. Download the converted/processed file
// -------------------------------------------------------------
// -------------------------------------------------------------
// 6. Download the converted/processed file
// -------------------------------------------------------------
app.get('/api/download/:jobId/file', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).send('Trabajo no encontrado.');
  }

  if (job.status === 'expired') {
    return res.status(410).send(`El archivo ha expirado tras ${FILE_TTL_MINUTES} minutos y fue eliminado del servidor para liberar espacio.`);
  }

  if (!job.filePath || !fs.existsSync(job.filePath)) {
    return res.status(404).send('Archivo no encontrado o ya eliminado.');
  }

  const downloadName = job.fileName || `media-${jobId}.${job.format}`;
  logger.info('DELIVERY', `Enviando archivo "${downloadName}" al cliente`);

  res.download(job.filePath, downloadName, (err) => {
    if (err && !res.headersSent) {
      logger.error('DELIVERY', 'Error transmitiendo archivo:', err.message);
      res.status(500).send('Error al descargar el archivo.');
    }
  });
});

// -------------------------------------------------------------
// 7. Cancel a download job
// -------------------------------------------------------------
app.post('/api/cancel/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = jobs.get(jobId);

  if (!job) {
    return res.status(404).json({ error: 'Trabajo no encontrado.' });
  }

  if (job.cleanupTimer) {
    clearTimeout(job.cleanupTimer);
  }

  if (job.childProcess) {
    job.status = 'cancelled';
    job.stageMessage = 'Descarga cancelada por el usuario.';
    logger.warn('CANCEL', `Cancelando trabajo [Job ${jobId}]`);
    try {
      job.childProcess.kill('SIGTERM');
    } catch (e) {
      logger.error('CANCEL', 'Error matando proceso:', e.message);
    }
  }

  // Delete partial file if exists
  if (job.filePath && fs.existsSync(job.filePath)) {
    try { fs.unlinkSync(job.filePath); } catch {}
  }

  notifyJobListeners(job);
  res.json({ success: true, message: 'Descarga cancelada.' });
});

// -------------------------------------------------------------
// 8. Recent downloads history
// -------------------------------------------------------------
app.get('/api/history', (req, res) => {
  const list = Array.from(jobs.values())
    .map(j => ({
      id: j.id,
      title: j.title,
      type: j.type,
      format: j.format,
      quality: j.quality,
      status: j.status,
      fileSize: j.status === 'expired' ? 'Expirado (>10m)' : j.fileSize,
      fileName: j.fileName,
      createdAt: j.createdAt,
      completedAt: j.completedAt || null,
      expiresAt: j.expiresAt || null,
      downloadUrl: (j.status === 'ready' && j.filePath && fs.existsSync(j.filePath)) ? `/api/download/${j.id}/file` : null
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 15);

  res.json(list);
});

// -------------------------------------------------------------
// Start server
// -------------------------------------------------------------
const server = app.listen(PORT, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 YouTube Downloader Backend`);
  console.log(`👉 Escuchando en: http://localhost:${PORT}`);
  console.log(`📁 Carpeta de descargas: ${DOWNLOADS_DIR}`);
  console.log(`⏱️  Retención de archivos (TTL): \x1b[33m${FILE_TTL_MINUTES} minutos\x1b[0m`);
  console.log(`🛠️  Modo de Depuración (DEBUG): ${DEBUG ? '\x1b[32mACTIVADO (verbose)\x1b[0m' : '\x1b[33mDESACTIVADO\x1b[0m'}`);
  console.log(`🌐 Clientes YouTube anti-403: \x1b[36m${PLAYER_CLIENTS}\x1b[0m`);
  console.log(`======================================================\n`);
  logger.info('SERVER', `Servidor iniciado con éxito en puerto ${PORT} (TTL: ${FILE_TTL_MINUTES}m)`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ Error: El puerto ${PORT} ya está siendo utilizado.`);
    console.error(`💡 Si el servicio del sistema (systemd) ya está corriendo en segundo plano,`);
    console.error(`   no es necesario ejecutar "npm start" manualmente.`);
    console.error(`   Para gestionar el servicio: systemctl --user status yt-downloader\n`);
  } else {
    console.error('Error al iniciar el servidor:', err);
  }
  process.exit(1);
});
