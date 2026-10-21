/**
 * YouTube Downloader - Content Script
 * Injects a sleek download button directly into YouTube's video actions toolbar.
 */

(function () {
  const SERVER_BASE = 'http://localhost:23458';
  let activeMenu = null;

  function showToast(message, type = 'info', duration = 4000) {
    const existing = document.querySelector('.ytdl-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'ytdl-toast';
    const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '⚡';
    toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  async function checkServer() {
    try {
      const res = await fetch(`${SERVER_BASE}/api/health`, { method: 'GET' });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function startQuickDownload(type, format, quality) {
    const isOnline = await checkServer();
    if (!isOnline) {
      showToast('Servidor Node desconectado (puerto 23458). Ejecuta "npm start" o el servicio del sistema.', 'error', 5000);
      return;
    }

    const currentUrl = window.location.href;
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
    const title = titleEl ? titleEl.textContent.trim() : 'Video de YouTube';

    showToast(`Iniciando descarga de ${type === 'audio' ? 'Audio MP3' : 'Video MP4'}...`, 'info', 2500);

    try {
      const res = await fetch(`${SERVER_BASE}/api/download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: currentUrl,
          type,
          format,
          quality,
          title
        })
      });

      if (!res.ok) {
        const err = await res.json();
        showToast(`Error: ${err.error || 'No se pudo iniciar'}`, 'error');
        return;
      }

      const { jobId } = await res.json();

      // Listen to SSE progress
      const sse = new EventSource(`${SERVER_BASE}/api/progress/${jobId}`);
      sse.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.status === 'downloading') {
            chrome.runtime.sendMessage({
              type: 'UPDATE_BADGE',
              text: `${Math.round(data.percent)}%`,
              color: '#FF0033'
            }).catch(() => {});
          } else if (data.status === 'converting') {
            chrome.runtime.sendMessage({
              type: 'UPDATE_BADGE',
              text: 'CONV',
              color: '#7928CA'
            }).catch(() => {});
          } else if (data.status === 'ready') {
            sse.close();
            showToast('¡Descarga y conversión listas! Guardando archivo...', 'success', 4000);
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_FILE',
              url: `${SERVER_BASE}/api/download/${jobId}/file`,
              fileName: data.fileName,
              saveAs: true
            }).catch(() => {});
          } else if (data.status === 'error') {
            sse.close();
            showToast(`Error: ${data.error || 'Error al procesar'}`, 'error', 5000);
            chrome.runtime.sendMessage({ type: 'NOTIFY_ERROR', error: data.error }).catch(() => {});
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };

      sse.onerror = () => {
        sse.close();
      };

    } catch (err) {
      showToast('Error de conexión con el backend.', 'error');
      console.error(err);
    }
  }

  function injectButton() {
    if (document.getElementById('ytdl-native-button')) return;

    // Target the action toolbar in YouTube
    const targetContainer = document.querySelector(
      '#top-level-buttons-computed, #actions-inner #menu, #actions.ytd-watch-metadata'
    );

    if (!targetContainer) return;

    const btnWrapper = document.createElement('div');
    btnWrapper.style.position = 'relative';
    btnWrapper.style.display = 'inline-block';

    const btn = document.createElement('button');
    btn.id = 'ytdl-native-button';
    btn.className = 'ytdl-native-btn';
    btn.innerHTML = `
      <svg viewBox="0 0 24 24">
        <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
      </svg>
      <span>Descargar</span>
    `;

    // Dropdown menu
    const menu = document.createElement('div');
    menu.className = 'ytdl-quick-modal';
    menu.style.display = 'none';
    menu.innerHTML = `
      <button class="ytdl-menu-item" id="ytdl-quick-video">
        <span class="icon">📹</span>
        <span>Video MP4 (Mejor)</span>
      </button>
      <button class="ytdl-menu-item" id="ytdl-quick-audio">
        <span class="icon">🎵</span>
        <span>Audio MP3 (320k)</span>
      </button>
      <div class="ytdl-menu-divider"></div>
      <button class="ytdl-menu-item" id="ytdl-open-popup-info" style="opacity: 0.8; font-size: 12px;">
        <span class="icon">⚙️</span>
        <span>Más formatos y calidades</span>
      </button>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = menu.style.display === 'flex';
      menu.style.display = isVisible ? 'none' : 'flex';
      activeMenu = isVisible ? null : menu;
    });

    menu.querySelector('#ytdl-quick-video').addEventListener('click', () => {
      menu.style.display = 'none';
      startQuickDownload('video', 'mp4', 'best');
    });

    menu.querySelector('#ytdl-quick-audio').addEventListener('click', () => {
      menu.style.display = 'none';
      startQuickDownload('audio', 'mp3', '320k');
    });

    menu.querySelector('#ytdl-open-popup-info').addEventListener('click', () => {
      menu.style.display = 'none';
      showToast('Haz clic en el icono de la extensión en la barra de Chrome para todas las resoluciones y conversiones.', 'info', 4500);
    });

    btnWrapper.appendChild(btn);
    btnWrapper.appendChild(menu);

    targetContainer.appendChild(btnWrapper);
  }

  // Close dropdown on outside click
  document.addEventListener('click', () => {
    if (activeMenu) {
      activeMenu.style.display = 'none';
      activeMenu = null;
    }
  });

  // Watch for YouTube SPA page changes
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(injectButton, 1000);
  });

  // Fallback observer
  const observer = new MutationObserver(() => {
    if (window.location.pathname.startsWith('/watch') || window.location.pathname.startsWith('/shorts')) {
      if (!document.getElementById('ytdl-native-button')) {
        injectButton();
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(injectButton, 1500);
})();
