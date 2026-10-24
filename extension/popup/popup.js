/**
 * YouTube Downloader & Converter Pro - Popup Controller
 * Communicates with the Node.js backend, handles real-time SSE progress,
 * format conversion options, and Chrome download manager triggers.
 */

const SERVER_BASE = 'http://localhost:23458';

// State
let currentTabUrl = '';
let currentVideoInfo = null;
let currentJobId = null;
let activeSSE = null;
let activeType = 'video'; // 'video' | 'audio'
let completedDownloadUrl = null;
let completedFileName = null;

// DOM Elements
const statusPill = document.getElementById('statusPill');
const statusLabel = document.getElementById('statusLabel');
const offlineCard = document.getElementById('offlineCard');
const copyCmdBtn = document.getElementById('copyCmdBtn');
const btnRetryConnection = document.getElementById('btnRetryConnection');

const videoUrlInput = document.getElementById('videoUrlInput');
const clearUrlBtn = document.getElementById('clearUrlBtn');
const fetchInfoBtn = document.getElementById('fetchInfoBtn');

const infoLoader = document.getElementById('infoLoader');
const videoPreviewCard = document.getElementById('videoPreviewCard');
const videoThumb = document.getElementById('videoThumb');
const videoDuration = document.getElementById('videoDuration');
const videoTitle = document.getElementById('videoTitle');
const videoChannel = document.getElementById('videoChannel');

const tabVideo = document.getElementById('tabVideo');
const tabAudio = document.getElementById('tabAudio');
const paneVideo = document.getElementById('paneVideo');
const paneAudio = document.getElementById('paneAudio');

const videoQualitySelect = document.getElementById('videoQualitySelect');
const videoFormatSelect = document.getElementById('videoFormatSelect');
const audioFormatSelect = document.getElementById('audioFormatSelect');
const audioBitrateSelect = document.getElementById('audioBitrateSelect');

const startDownloadBtn = document.getElementById('startDownloadBtn');
const downloadBtnText = document.getElementById('downloadBtnText');

const progressCard = document.getElementById('progressCard');
const progressStage = document.getElementById('progressStage');
const progressPct = document.getElementById('progressPct');
const progressFill = document.getElementById('progressFill');
const metricSpeed = document.getElementById('metricSpeed');
const metricEta = document.getElementById('metricEta');
const cancelJobBtn = document.getElementById('cancelJobBtn');

const completedCard = document.getElementById('completedCard');
const completedFileNameEl = document.getElementById('completedFileName');
const btnSaveFile = document.getElementById('btnSaveFile');
const btnNewDownload = document.getElementById('btnNewDownload');

const toggleHistoryBtn = document.getElementById('toggleHistoryBtn');
const historyArrow = document.getElementById('historyArrow');
const historyList = document.getElementById('historyList');
const historyItems = document.getElementById('historyItems');
const historyEmpty = document.getElementById('historyEmpty');

// -------------------------------------------------------------
// 1. Connection check with Node server
// -------------------------------------------------------------
async function checkBackendConnection() {
  statusPill.className = 'status-indicator';
  statusLabel.textContent = 'Verificando...';

  try {
    const res = await fetch(`${SERVER_BASE}/api/health`, { method: 'GET' });
    if (res.ok) {
      statusPill.className = 'status-indicator online';
      statusLabel.textContent = 'Conectado';
      offlineCard.style.display = 'none';
      startDownloadBtn.disabled = false;
      return true;
    }
    throw new Error('Not OK');
  } catch {
    statusPill.className = 'status-indicator offline';
    statusLabel.textContent = 'Offline';
    offlineCard.style.display = 'flex';
    startDownloadBtn.disabled = true;
    return false;
  }
}

// -------------------------------------------------------------
// 2. Tab URL Auto-Detection
// -------------------------------------------------------------
async function detectActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url) {
      const url = tab.url;
      const isYouTube = /(?:youtube\.com\/(?:watch|shorts|embed)|youtu\.be\/)/i.test(url);
      const isInstagram = /(?:instagram\.com\/(?:p|reel|reels)\/)/i.test(url);
      const isFacebook = /(?:facebook\.com\/(?:watch|reel|reels|share|.*videos?|video\.php)|fb\.watch\/)/i.test(url);
      if (isYouTube || isInstagram || isFacebook) {
        currentTabUrl = url;
        videoUrlInput.value = url;
        clearUrlBtn.style.display = 'block';
        await loadVideoInfo(url);
      }
    }
  } catch (err) {
    console.warn('Could not inspect tab:', err);
  }
}

// -------------------------------------------------------------
// 3. Fetch Video Info & Dynamic Qualities
// -------------------------------------------------------------
async function loadVideoInfo(url) {
  if (!url || !url.trim()) return;

  const isOnline = await checkBackendConnection();
  if (!isOnline) return;

  infoLoader.style.display = 'flex';
  videoPreviewCard.style.display = 'none';

  try {
    const res = await fetch(`${SERVER_BASE}/api/info?url=${encodeURIComponent(url.trim())}`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'No se pudo cargar la información del video');
    }

    const data = await res.json();
    currentVideoInfo = data;

    // Fill UI
    videoThumb.src = data.thumbnail;
    videoDuration.textContent = data.durationFormatted || '0:00';
    videoTitle.textContent = data.title;
    videoTitle.title = data.title;
    videoChannel.textContent = data.uploader || 'Canal desconocido';

    // Populate video qualities
    if (data.videoQualities && data.videoQualities.length > 0) {
      videoQualitySelect.innerHTML = '';
      data.videoQualities.forEach((q) => {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.label;
        videoQualitySelect.appendChild(opt);
      });
    }

    infoLoader.style.display = 'none';
    videoPreviewCard.style.display = 'flex';
    updateDownloadButtonText();
  } catch (err) {
    infoLoader.style.display = 'none';
    alert(`Error: ${err.message}`);
  }
}

// -------------------------------------------------------------
// 4. Mode Switching (Video vs Audio)
// -------------------------------------------------------------
function switchType(type) {
  activeType = type;
  if (type === 'video') {
    tabVideo.classList.add('active');
    tabAudio.classList.remove('active');
    paneVideo.style.display = 'block';
    paneAudio.style.display = 'none';
  } else {
    tabAudio.classList.add('active');
    tabVideo.classList.remove('active');
    paneAudio.style.display = 'block';
    paneVideo.style.display = 'none';
  }
  updateDownloadButtonText();
}

function updateDownloadButtonText() {
  if (activeType === 'video') {
    const format = (videoFormatSelect.value || 'mp4').toUpperCase();
    const quality = videoQualitySelect.options[videoQualitySelect.selectedIndex]?.text.split(' ')[0] || '';
    downloadBtnText.textContent = `Descargar Video (${format} ${quality})`;
  } else {
    const format = (audioFormatSelect.value || 'mp3').toUpperCase();
    const bitrate = audioBitrateSelect.value || '192k';
    downloadBtnText.textContent = `Convertir a Audio (${format} - ${bitrate})`;
  }
}

// -------------------------------------------------------------
// 5. Start Download & Handle Live SSE Progress
// -------------------------------------------------------------
async function handleStartDownload() {
  const url = videoUrlInput.value.trim();
  if (!url) {
    alert('Por favor, ingresa una URL válida de YouTube, Instagram o Facebook.');
    videoUrlInput.focus();
    return;
  }

  const isOnline = await checkBackendConnection();
  if (!isOnline) {
    alert('El servidor Node.js no está activo. Inícialo con "npm start" en la terminal.');
    return;
  }

  const type = activeType;
  const format = type === 'video' ? videoFormatSelect.value : audioFormatSelect.value;
  const quality = type === 'video' ? videoQualitySelect.value : audioBitrateSelect.value;
  const title = currentVideoInfo ? currentVideoInfo.title : 'video';

  startDownloadBtn.disabled = true;
  downloadBtnText.textContent = 'Preparando...';

  try {
    const res = await fetch(`${SERVER_BASE}/api/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, type, format, quality, title })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Error al iniciar la descarga');
    }

    const { jobId } = await res.json();
    currentJobId = jobId;

    // Show progress UI
    progressCard.style.display = 'flex';
    completedCard.style.display = 'none';
    progressFill.style.width = '0%';
    progressPct.textContent = '0%';
    progressStage.textContent = type === 'audio' ? 'Descargando audio...' : 'Descargando video...';
    metricSpeed.textContent = '--';
    metricEta.textContent = '--';

    // Start listening to Server-Sent Events (SSE)
    if (activeSSE) {
      activeSSE.close();
    }

    activeSSE = new EventSource(`${SERVER_BASE}/api/progress/${jobId}`);

    activeSSE.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Update progress bar & percentages
        const pct = Math.round(data.percent || 0);
        progressFill.style.width = `${pct}%`;
        progressPct.textContent = `${pct}%`;
        metricSpeed.textContent = data.speed || '--';
        metricEta.textContent = data.eta || '--';

        if (data.stageMessage) {
          progressStage.textContent = data.stageMessage;
        }

        // Update Chrome extension badge text
        chrome.runtime.sendMessage({
          type: 'UPDATE_BADGE',
          text: `${pct}%`,
          color: activeType === 'audio' ? '#8b5cf6' : '#ff0033'
        }).catch(() => {});

        // On finished
        if (data.status === 'ready') {
          activeSSE.close();
          activeSSE = null;
          onJobCompleted(data);
        } else if (data.status === 'error') {
          activeSSE.close();
          activeSSE = null;
          onJobError(data.error || 'Error inesperado durante la descarga');
        }
      } catch (e) {
        console.error('SSE JSON error:', e);
      }
    };

    activeSSE.onerror = () => {
      console.warn('SSE disconnected or closed.');
    };

  } catch (err) {
    alert(`Error: ${err.message}`);
    startDownloadBtn.disabled = false;
    updateDownloadButtonText();
  }
}

// -------------------------------------------------------------
// 6. Finished & Error Handlers
// -------------------------------------------------------------
function onJobCompleted(jobData) {
  progressCard.style.display = 'none';
  completedCard.style.display = 'flex';
  startDownloadBtn.disabled = false;
  updateDownloadButtonText();

  completedDownloadUrl = `${SERVER_BASE}${jobData.downloadUrl}`;
  completedFileName = jobData.fileName || 'media_download';
  completedFileNameEl.textContent = completedFileName;

  // Notify background script
  chrome.runtime.sendMessage({
    type: 'NOTIFY_COMPLETED',
    fileName: completedFileName
  }).catch(() => {});

  // Automatically trigger Chrome native download dialog/save
  triggerFileSave();
}

function onJobError(errorMessage) {
  progressCard.style.display = 'none';
  startDownloadBtn.disabled = false;
  updateDownloadButtonText();
  alert(`Error en la descarga: ${errorMessage}`);

  chrome.runtime.sendMessage({
    type: 'NOTIFY_ERROR',
    error: errorMessage
  }).catch(() => {});
}

// -------------------------------------------------------------
// 7. Save file via Chrome Downloads API
// -------------------------------------------------------------
async function triggerFileSave() {
  if (!completedDownloadUrl) return;

  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_FILE',
    url: completedDownloadUrl,
    fileName: completedFileName,
    saveAs: true
  }, (response) => {
    if (chrome.runtime.lastError || (response && !response.success)) {
      // Fallback: direct window open/download
      window.open(completedDownloadUrl, '_blank');
    }
  });
}

// -------------------------------------------------------------
// 8. Cancel Active Download
// -------------------------------------------------------------
async function cancelCurrentJob() {
  if (!currentJobId) return;

  try {
    await fetch(`${SERVER_BASE}/api/cancel/${currentJobId}`, { method: 'POST' });
  } catch (e) {
    console.error('Cancel request failed:', e);
  }

  if (activeSSE) {
    activeSSE.close();
    activeSSE = null;
  }

  progressCard.style.display = 'none';
  startDownloadBtn.disabled = false;
  updateDownloadButtonText();

  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', text: '' }).catch(() => {});
}

// -------------------------------------------------------------
// 9. Recent Downloads Drawer
// -------------------------------------------------------------
async function loadHistory() {
  try {
    const res = await fetch(`${SERVER_BASE}/api/history`);
    if (!res.ok) return;
    const history = await res.json();

    if (!history || history.length === 0) {
      historyEmpty.style.display = 'block';
      historyItems.innerHTML = '';
      return;
    }

    historyEmpty.style.display = 'none';
    historyItems.innerHTML = '';

    history.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.innerHTML = `
        <div class="history-item-info">
          <div class="history-item-title" title="${item.title}">${item.title}</div>
          <div>
            <span class="history-item-badge">${(item.format || 'MP4').toUpperCase()}</span>
            <span class="history-item-badge">${item.fileSize || item.quality || ''}</span>
          </div>
        </div>
        ${
          item.status === 'ready' && item.downloadUrl
            ? `<button class="history-item-btn" data-url="${SERVER_BASE}${item.downloadUrl}" data-name="${item.fileName}">Guardar</button>`
            : `<span style="color: #9ba1b0; font-size: 10px;">${item.status === 'expired' ? 'Expirado (>10m)' : item.status}</span>`
        }
      `;

      const dlBtn = el.querySelector('.history-item-btn');
      if (dlBtn) {
        dlBtn.addEventListener('click', () => {
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: dlBtn.dataset.url,
            fileName: dlBtn.dataset.name,
            saveAs: true
          });
        });
      }

      historyItems.appendChild(el);
    });
  } catch (err) {
    console.warn('Could not load history:', err);
  }
}

// -------------------------------------------------------------
// 10. Event Listeners Setup
// -------------------------------------------------------------
function setupEventListeners() {
  // Retry connection
  btnRetryConnection.addEventListener('click', checkBackendConnection);
  statusPill.addEventListener('click', checkBackendConnection);

  // Copy command
  copyCmdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText('npm start');
    copyCmdBtn.textContent = '✓';
    setTimeout(() => { copyCmdBtn.textContent = '📋'; }, 2000);
  });

  // URL input controls
  videoUrlInput.addEventListener('input', () => {
    clearUrlBtn.style.display = videoUrlInput.value ? 'block' : 'none';
  });

  videoUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      loadVideoInfo(videoUrlInput.value.trim());
    }
  });

  clearUrlBtn.addEventListener('click', () => {
    videoUrlInput.value = '';
    clearUrlBtn.style.display = 'none';
    videoPreviewCard.style.display = 'none';
    currentVideoInfo = null;
    videoUrlInput.focus();
  });

  fetchInfoBtn.addEventListener('click', () => {
    loadVideoInfo(videoUrlInput.value.trim());
  });

  // Type tabs
  tabVideo.addEventListener('click', () => switchType('video'));
  tabAudio.addEventListener('click', () => switchType('audio'));

  // Option changes
  videoQualitySelect.addEventListener('change', updateDownloadButtonText);
  videoFormatSelect.addEventListener('change', updateDownloadButtonText);
  audioFormatSelect.addEventListener('change', updateDownloadButtonText);
  audioBitrateSelect.addEventListener('change', updateDownloadButtonText);

  // Action buttons
  startDownloadBtn.addEventListener('click', handleStartDownload);
  cancelJobBtn.addEventListener('click', cancelCurrentJob);
  btnSaveFile.addEventListener('click', triggerFileSave);

  btnNewDownload.addEventListener('click', () => {
    completedCard.style.display = 'none';
    progressCard.style.display = 'none';
    updateDownloadButtonText();
  });

  // History Drawer toggle
  toggleHistoryBtn.addEventListener('click', () => {
    const isClosed = historyList.style.display === 'none';
    historyList.style.display = isClosed ? 'flex' : 'none';
    if (historyArrow) historyArrow.style.transform = isClosed ? 'rotate(180deg)' : 'rotate(0deg)';
    if (isClosed) {
      loadHistory();
    }
  });
}

// -------------------------------------------------------------
// 11. App Initialization
// -------------------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  updateDownloadButtonText();

  const isOnline = await checkBackendConnection();
  if (isOnline) {
    await detectActiveTab();
  }
});
