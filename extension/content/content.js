/**
 * YouTube & Instagram Downloader Pro - Content Script
 * Injects sleek, native-looking download controls into:
 * 1. YouTube standard watch pages
 * 2. YouTube Shorts (in .ytReelPlayerOverlayViewModelActionsContainer reel-action-bar-view-model)
 * 3. Instagram Reels (vertical action column)
 * 4. Instagram Posts & Carousels (photo/video action toolbar)
 *
 * All backend operations are proxied through service-worker.js to bypass
 * Mixed-Content and CORS restrictions completely.
 * Photo downloads use 100% frontend logic (saving backend CPU/bandwidth).
 */

(function () {
  'use strict';

  let activeDropdown = null;

  // -------------------------------------------------------------
  // 1. Toast Notifications
  // -------------------------------------------------------------
  function showToast(message, type = 'info', duration = 3500) {
    const existing = document.querySelector('.ytdl-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'ytdl-toast';
    const icon = type === 'error' ? '❌' : type === 'success' ? '✅' : '⚡';

    toast.innerHTML = `
      <span class="ytdl-toast-icon">${icon}</span>
      <div class="ytdl-toast-body">
        <span class="ytdl-toast-message">${message}</span>
      </div>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      toast.style.transition = 'all 0.25s ease';
      setTimeout(() => toast.remove(), 250);
    }, duration);
  }

  // Close open dropdowns when clicking outside
  document.addEventListener('click', (e) => {
    if (activeDropdown && !activeDropdown.contains(e.target)) {
      activeDropdown.style.display = 'none';
      activeDropdown = null;
    }
  });

  // -------------------------------------------------------------
  // 2. Service Worker Messaging & Backend Downloads
  // -------------------------------------------------------------
  async function checkBackend() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'CHECK_BACKEND' }, (res) => {
        if (chrome.runtime.lastError || !res || !res.online) {
          resolve(false);
        } else {
          resolve(true);
        }
      });
    });
  }

  async function startBackendDownload({ url, type = 'video', format = 'mp4', quality = 'best', title }) {
    const isOnline = await checkBackend();
    if (!isOnline) {
      showToast('Servidor Node.js desconectado (puerto 23458). Ejecuta "npm start" en el proyecto.', 'error', 5000);
      return;
    }

    showToast(`Iniciando descarga de ${type === 'audio' ? 'Audio MP3' : 'Video MP4'}...`, 'info', 2500);

    chrome.runtime.sendMessage({
      type: 'START_BACKEND_DOWNLOAD',
      payload: { url, type, format, quality, title }
    }, (res) => {
      if (chrome.runtime.lastError || !res?.success) {
        showToast(`Error: ${res?.error || 'No se pudo iniciar la descarga'}`, 'error', 4500);
      }
    });
  }

  // Listen for real-time progress updates from service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'DOWNLOAD_JOB_UPDATE') {
      const { status, percent, speed, fileName, error } = message.data || {};
      if (status === 'downloading') {
        const pct = Math.round(percent || 0);
        showToast(`Descargando: ${pct}% (${speed || '--'})`, 'info', 2000);
      } else if (status === 'converting') {
        showToast('Convirtiendo pistas con FFmpeg...', 'info', 2500);
      } else if (status === 'ready') {
        showToast(`¡Completado! Guardando "${fileName || 'archivo'}"...`, 'success', 4500);
      } else if (status === 'error') {
        showToast(`Error al procesar: ${error || 'Fallo desconocido'}`, 'error', 5000);
      }
    }
  });

  // -------------------------------------------------------------
  // 3. Frontend Photo Downloader (Saves Backend Resources)
  // -------------------------------------------------------------
  function extractBestImageUrl(imgEl) {
    if (!imgEl) return null;

    // Check srcset for highest resolution candidate
    const srcset = imgEl.getAttribute('srcset');
    if (srcset) {
      const candidates = srcset.split(',').map(s => {
        const parts = s.trim().split(/\s+/);
        const url = parts[0];
        const width = parseInt(parts[1]?.replace('w', ''), 10) || 0;
        return { url, width };
      });
      candidates.sort((a, b) => b.width - a.width);
      if (candidates.length > 0 && candidates[0].url) {
        return candidates[0].url;
      }
    }

    return imgEl.currentSrc || imgEl.src;
  }

  async function downloadPhotoFrontend(imgUrl, fileName) {
    if (!imgUrl) {
      showToast('No se encontró la imagen.', 'error');
      return;
    }

    showToast('Descargando imagen...', 'info', 2000);

    // Try client-side fetch -> Blob -> Download link first
    try {
      const response = await fetch(imgUrl, { mode: 'cors' });
      if (response.ok) {
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
          a.remove();
          URL.revokeObjectURL(blobUrl);
        }, 1500);
        showToast('¡Foto guardada con éxito!', 'success', 3500);
        return;
      }
    } catch (err) {
      console.warn('Frontend fetch direct blob failed, delegating to extension downloads API:', err);
    }

    // Fallback: chrome.downloads in service worker (has host_permissions for fbcdn and cdninstagram)
    chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url: imgUrl,
      fileName,
      saveAs: false
    }, (res) => {
      if (res?.success) {
        showToast('¡Foto guardada con éxito!', 'success', 3500);
      } else {
        showToast('Error al descargar la foto.', 'error', 4000);
      }
    });
  }

  // -------------------------------------------------------------
  // 4. YouTube Standard Watch Page Button
  // -------------------------------------------------------------
  function injectYouTubeWatchButton() {
    if (!window.location.pathname.startsWith('/watch')) return;
    if (document.getElementById('ytdl-native-button')) return;

    const targetContainer = document.querySelector(
      '#top-level-buttons-computed, ytd-watch-metadata #top-level-buttons-computed, #actions-inner #top-level-buttons-computed, #actions.ytd-watch-metadata'
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

    const menu = document.createElement('div');
    menu.className = 'ytdl-quick-modal';
    menu.style.display = 'none';
    menu.innerHTML = `
      <button class="ytdl-menu-item" id="ytdl-watch-video">
        <span class="icon">📹</span>
        <span>Video MP4 (Mejor)</span>
      </button>
      <button class="ytdl-menu-item" id="ytdl-watch-audio">
        <span class="icon">🎵</span>
        <span>Audio MP3 (320k)</span>
      </button>
      <div class="ytdl-menu-divider"></div>
      <button class="ytdl-menu-item action-subtext" id="ytdl-watch-info">
        <span class="icon">⚙️</span>
        <span>Más formatos en la extensión</span>
      </button>
    `;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const isVisible = menu.style.display === 'flex';
      menu.style.display = isVisible ? 'none' : 'flex';
      activeDropdown = isVisible ? null : menu;
    });

    const getTitle = () => {
      const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string');
      return titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '').trim();
    };

    menu.querySelector('#ytdl-watch-video').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      startBackendDownload({
        url: window.location.href,
        type: 'video',
        format: 'mp4',
        quality: 'best',
        title: getTitle()
      });
    });

    menu.querySelector('#ytdl-watch-audio').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      startBackendDownload({
        url: window.location.href,
        type: 'audio',
        format: 'mp3',
        quality: '320k',
        title: getTitle()
      });
    });

    menu.querySelector('#ytdl-watch-info').addEventListener('click', (e) => {
      e.stopPropagation();
      menu.style.display = 'none';
      showToast('Abre el icono de la extensión en Chrome para elegir resoluciones (4K, 1080p, etc.).', 'info', 4000);
    });

    btnWrapper.appendChild(btn);
    btnWrapper.appendChild(menu);
    targetContainer.appendChild(btnWrapper);
  }

  // -------------------------------------------------------------
  // 5. YouTube Shorts Button (.ytReelPlayerOverlayViewModelActionsContainer)
  // -------------------------------------------------------------
  function injectYouTubeShortsButton() {
    if (!window.location.pathname.startsWith('/shorts')) return;

    // Search for all active and loaded reel action bar containers
    const actionBars = document.querySelectorAll(
      '.ytReelPlayerOverlayViewModelActionsContainer reel-action-bar-view-model, reel-action-bar-view-model.ytwReelActionBarViewModelHost, ytd-reel-player-overlay-renderer #actions'
    );

    actionBars.forEach((actionBar) => {
      if (actionBar.querySelector('.ytdl-shorts-btn-host')) return;

      const host = document.createElement('div');
      host.className = 'ytdl-shorts-btn-host';

      const btn = document.createElement('button');
      btn.className = 'ytdl-shorts-download-btn';
      btn.title = 'Descargar Short';
      btn.setAttribute('aria-label', 'Descargar Short');
      btn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
      `;

      const label = document.createElement('div');
      label.className = 'ytdl-shorts-label';
      label.textContent = 'Descargar';

      const menu = document.createElement('div');
      menu.className = 'ytdl-shorts-menu';
      menu.style.display = 'none';
      menu.innerHTML = `
        <button class="ytdl-menu-item" id="ytdl-shorts-video">
          <span class="icon">📹</span>
          <span>Video MP4 (Mejor)</span>
        </button>
        <button class="ytdl-menu-item" id="ytdl-shorts-audio">
          <span class="icon">🎵</span>
          <span>Audio MP3 (320k)</span>
        </button>
      `;

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = menu.style.display === 'flex';
        menu.style.display = isVisible ? 'none' : 'flex';
        activeDropdown = isVisible ? null : menu;
      });

      const getShortsData = () => {
        // Resolve closest renderer or current page URL
        const container = actionBar.closest('ytd-reel-video-renderer, reel-player-header-view-model') || document;
        const titleEl = container.querySelector('h2.ytReelPlayerHeaderViewModelTitle, .ytReelPlayerHeaderViewModelTitle span, #headline.ytd-reel-player-header-renderer yt-formatted-string, h2');
        const title = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '').trim();
        const shortUrl = window.location.href;
        return { title, url: shortUrl };
      };

      menu.querySelector('#ytdl-shorts-video').addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        const { title, url } = getShortsData();
        startBackendDownload({
          url,
          type: 'video',
          format: 'mp4',
          quality: 'best',
          title: title || 'YouTube Short'
        });
      });

      menu.querySelector('#ytdl-shorts-audio').addEventListener('click', (e) => {
        e.stopPropagation();
        menu.style.display = 'none';
        const { title, url } = getShortsData();
        startBackendDownload({
          url,
          type: 'audio',
          format: 'mp3',
          quality: '320k',
          title: title || 'YouTube Short Audio'
        });
      });

      host.appendChild(btn);
      host.appendChild(label);
      host.appendChild(menu);

      // Insert before sound/pivot button if present, otherwise append
      const pivot = actionBar.querySelector('pivot-button-view-model');
      if (pivot) {
        actionBar.insertBefore(host, pivot);
      } else {
        actionBar.appendChild(host);
      }
    });
  }

  // -------------------------------------------------------------
  // 6. Instagram Reels & Posts Support
  // -------------------------------------------------------------
  function injectInstagramButtons() {
    const isReelPage = window.location.pathname.includes('/reel/') || window.location.pathname.includes('/reels/');

    // A) Handle Reels Action Column
    if (isReelPage) {
      // Find buttons with Instagram action svgs (Like, Comment, Share, Save)
      const actionSvgs = document.querySelectorAll(
        'svg[aria-label="Me gusta"], svg[aria-label="Like"], svg[aria-label="Compartir"], svg[aria-label="Share"], svg[aria-label="Guardar"], svg[aria-label="Save"]'
      );

      actionSvgs.forEach((svg) => {
        // Find the vertical button column container
        const actionColumn = svg.closest('div[class*="x1n2onr6"]') || svg.closest('section') || svg.closest('div[role="dialog"]');
        if (!actionColumn) return;

        // Ensure we target a container that holds the group of action buttons
        const buttonGroup = svg.closest('div[style*="flex-direction: column"]') || actionColumn.querySelector('div[style*="flex-direction: column"]') || actionColumn;
        if (!buttonGroup || buttonGroup.querySelector('.ytdl-ig-reel-container')) return;

        const reelWrapper = document.createElement('div');
        reelWrapper.className = 'ytdl-ig-reel-container';

        const reelBtn = document.createElement('button');
        reelBtn.className = 'ytdl-ig-btn';
        reelBtn.title = 'Descargar Reel';
        reelBtn.setAttribute('aria-label', 'Descargar Reel');
        reelBtn.innerHTML = `
          <svg viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
        `;

        const reelLabel = document.createElement('div');
        reelLabel.className = 'ytdl-ig-label';
        reelLabel.textContent = 'Descargar';

        const reelMenu = document.createElement('div');
        reelMenu.className = 'ytdl-ig-menu';
        reelMenu.style.display = 'none';
        reelMenu.innerHTML = `
          <button class="ytdl-menu-item" id="ytdl-ig-reel-direct">
            <span class="icon">⚡</span>
            <span>Video MP4 (Directo HD)</span>
          </button>
          <button class="ytdl-menu-item" id="ytdl-ig-reel-audio">
            <span class="icon">🎵</span>
            <span>Audio MP3 (Backend)</span>
          </button>
          <button class="ytdl-menu-item" id="ytdl-ig-reel-backend">
            <span class="icon">📹</span>
            <span>Video MP4 (Backend)</span>
          </button>
        `;

        reelBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isVisible = reelMenu.style.display === 'flex';
          reelMenu.style.display = isVisible ? 'none' : 'flex';
          activeDropdown = isVisible ? null : reelMenu;
        });

        const getReelVideoSrc = () => {
          // Find video in the same section or reel container
          const parentContainer = actionColumn.closest('article, section, main, div[role="dialog"]') || document;
          const videoEl = parentContainer.querySelector('video');
          return videoEl?.currentSrc || videoEl?.src || null;
        };

        // Direct Video download (Frontend logic: zero backend resources)
        reelMenu.querySelector('#ytdl-ig-reel-direct').addEventListener('click', (e) => {
          e.stopPropagation();
          reelMenu.style.display = 'none';
          const videoSrc = getReelVideoSrc();
          if (videoSrc && !videoSrc.startsWith('blob:')) {
            showToast('Descargando Reel directamente...', 'info', 2500);
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_FILE',
              url: videoSrc,
              fileName: `instagram_reel_${Date.now()}.mp4`,
              saveAs: false
            });
          } else {
            // If blob or direct src unavailable, fall back to backend
            showToast('Procesando video vía backend...', 'info', 2500);
            startBackendDownload({
              url: window.location.href,
              type: 'video',
              format: 'mp4',
              quality: 'best',
              title: `Instagram Reel ${Date.now()}`
            });
          }
        });

        // Audio MP3 conversion via backend
        reelMenu.querySelector('#ytdl-ig-reel-audio').addEventListener('click', (e) => {
          e.stopPropagation();
          reelMenu.style.display = 'none';
          startBackendDownload({
            url: window.location.href,
            type: 'audio',
            format: 'mp3',
            quality: '320k',
            title: `Instagram Reel Audio ${Date.now()}`
          });
        });

        // Full backend download
        reelMenu.querySelector('#ytdl-ig-reel-backend').addEventListener('click', (e) => {
          e.stopPropagation();
          reelMenu.style.display = 'none';
          startBackendDownload({
            url: window.location.href,
            type: 'video',
            format: 'mp4',
            quality: 'best',
            title: `Instagram Reel ${Date.now()}`
          });
        });

        reelWrapper.appendChild(reelBtn);
        reelWrapper.appendChild(reelLabel);
        reelWrapper.appendChild(reelMenu);
        buttonGroup.appendChild(reelWrapper);
      });
    }

    // B) Handle Feed Posts, Modals, and Photos (/p/)
    const postArticles = document.querySelectorAll('article:not(.ytdl-processed), div[role="dialog"]:not(.ytdl-processed)');
    postArticles.forEach((article) => {
      // Find Bookmark / Save or Share button in the post action toolbar
      const saveIcon = article.querySelector('svg[aria-label="Guardar"], svg[aria-label="Save"], svg[aria-label="Bookmark"]');
      const shareIcon = article.querySelector('svg[aria-label="Compartir"], svg[aria-label="Share"]');
      const targetIcon = saveIcon || shareIcon;
      if (!targetIcon) return;

      const actionRow = targetIcon.closest('div[role="button"]')?.parentNode || targetIcon.closest('button')?.parentNode;
      if (!actionRow || actionRow.querySelector('.ytdl-ig-post-btn-wrapper')) return;

      article.classList.add('ytdl-processed');

      const wrapper = document.createElement('div');
      wrapper.className = 'ytdl-ig-post-btn-wrapper';

      const postBtn = document.createElement('button');
      postBtn.className = 'ytdl-ig-post-btn';
      postBtn.title = 'Descargar contenido de la publicación';
      postBtn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
      `;

      const postMenu = document.createElement('div');
      postMenu.className = 'ytdl-ig-menu';
      postMenu.style.display = 'none';

      postBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        // Dynamically inspect whether the post has video or image
        const videoEl = article.querySelector('video');
        const imgEls = article.querySelectorAll('img[src*="cdninstagram"], img[src*="fbcdn"], img[srcset]');

        postMenu.innerHTML = '';

        if (videoEl) {
          const directBtn = document.createElement('button');
          directBtn.className = 'ytdl-menu-item';
          directBtn.innerHTML = '<span class="icon">⚡</span><span>Descargar Video (HD Directo)</span>';
          directBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            postMenu.style.display = 'none';
            const vSrc = videoEl.currentSrc || videoEl.src;
            if (vSrc && !vSrc.startsWith('blob:')) {
              showToast('Descargando video directamente...', 'info', 2500);
              chrome.runtime.sendMessage({
                type: 'DOWNLOAD_FILE',
                url: vSrc,
                fileName: `instagram_video_${Date.now()}.mp4`,
                saveAs: false
              });
            } else {
              startBackendDownload({
                url: window.location.href,
                type: 'video',
                format: 'mp4',
                quality: 'best',
                title: `Instagram Video ${Date.now()}`
              });
            }
          });
          postMenu.appendChild(directBtn);

          const audioBtn = document.createElement('button');
          audioBtn.className = 'ytdl-menu-item';
          audioBtn.innerHTML = '<span class="icon">🎵</span><span>Convertir a Audio MP3</span>';
          audioBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            postMenu.style.display = 'none';
            startBackendDownload({
              url: window.location.href,
              type: 'audio',
              format: 'mp3',
              quality: '320k',
              title: `Instagram Audio ${Date.now()}`
            });
          });
          postMenu.appendChild(audioBtn);
        }

        if (imgEls.length > 0) {
          // Frontend photo download (Single or active photo)
          const photoBtn = document.createElement('button');
          photoBtn.className = 'ytdl-menu-item';
          photoBtn.innerHTML = '<span class="icon">🖼️</span><span>Descargar Foto Actual (HD)</span>';
          photoBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            postMenu.style.display = 'none';
            // Pick active or most prominent image
            const activeImg = Array.from(imgEls).find(img => img.offsetParent !== null) || imgEls[0];
            const bestUrl = extractBestImageUrl(activeImg);
            downloadPhotoFrontend(bestUrl, `instagram_photo_${Date.now()}.jpg`);
          });
          postMenu.appendChild(photoBtn);

          // If carousel with multiple images, allow downloading all
          if (imgEls.length > 1) {
            const allPhotosBtn = document.createElement('button');
            allPhotosBtn.className = 'ytdl-menu-item';
            allPhotosBtn.innerHTML = `<span class="icon">📦</span><span>Descargar ${imgEls.length} Fotos (Carrusel)</span>`;
            allPhotosBtn.addEventListener('click', (ev) => {
              ev.stopPropagation();
              postMenu.style.display = 'none';
              showToast(`Descargando ${imgEls.length} fotos...`, 'info', 3000);
              imgEls.forEach((img, idx) => {
                setTimeout(() => {
                  const bestUrl = extractBestImageUrl(img);
                  downloadPhotoFrontend(bestUrl, `instagram_photo_${Date.now()}_${idx + 1}.jpg`);
                }, idx * 400);
              });
            });
            postMenu.appendChild(allPhotosBtn);
          }
        }

        const isVisible = postMenu.style.display === 'flex';
        postMenu.style.display = isVisible ? 'none' : 'flex';
        activeDropdown = isVisible ? null : postMenu;
      });

      wrapper.appendChild(postBtn);
      wrapper.appendChild(postMenu);
      actionRow.appendChild(wrapper);
    });
  }

  // -------------------------------------------------------------
  // 7. Facebook Videos, Reels & Watch Support
  // -------------------------------------------------------------
  function injectFacebookButtons() {
    const isReelPage = window.location.pathname.includes('/reel/') || window.location.pathname.includes('/reels/');

    // A) Facebook Reels Action Column
    if (isReelPage) {
      const actionSvgs = document.querySelectorAll(
        'svg[aria-label="Me gusta"], svg[aria-label="Like"], svg[aria-label="Compartir"], svg[aria-label="Share"], svg[aria-label="Comentar"], svg[aria-label="Comment"]'
      );

      actionSvgs.forEach((svg) => {
        const actionBtn = svg.closest('div[role="button"]') || svg.closest('div[tabindex="0"]');
        if (!actionBtn) return;

        const actionGroup = actionBtn.parentElement;
        if (!actionGroup || actionGroup.querySelector('.ytdl-fb-reel-container')) return;

        const reelWrapper = document.createElement('div');
        reelWrapper.className = 'ytdl-fb-reel-container';

        const reelBtn = document.createElement('button');
        reelBtn.className = 'ytdl-fb-btn';
        reelBtn.title = 'Descargar Reel de Facebook';
        reelBtn.setAttribute('aria-label', 'Descargar Reel de Facebook');
        reelBtn.innerHTML = `
          <svg viewBox="0 0 24 24">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
          </svg>
        `;

        const reelLabel = document.createElement('div');
        reelLabel.className = 'ytdl-fb-label';
        reelLabel.textContent = 'Descargar';

        const reelMenu = document.createElement('div');
        reelMenu.className = 'ytdl-fb-menu';
        reelMenu.style.display = 'none';
        reelMenu.innerHTML = `
          <button class="ytdl-menu-item" id="ytdl-fb-reel-direct">
            <span class="icon">⚡</span>
            <span>Video MP4 (Directo HD)</span>
          </button>
          <button class="ytdl-menu-item" id="ytdl-fb-reel-backend">
            <span class="icon">📹</span>
            <span>Video MP4 (Backend)</span>
          </button>
          <button class="ytdl-menu-item" id="ytdl-fb-reel-audio">
            <span class="icon">🎵</span>
            <span>Audio MP3 (Backend)</span>
          </button>
        `;

        reelBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const isVisible = reelMenu.style.display === 'flex';
          reelMenu.style.display = isVisible ? 'none' : 'flex';
          activeDropdown = isVisible ? null : reelMenu;
        });

        const getFbVideoSrc = () => {
          const parentContainer = actionGroup.closest('div[role="dialog"], div[data-pagelet*="Reels"], main, article') || document;
          const videoEl = parentContainer.querySelector('video');
          return videoEl?.currentSrc || videoEl?.src || null;
        };

        // Direct Download
        reelMenu.querySelector('#ytdl-fb-reel-direct').addEventListener('click', (e) => {
          e.stopPropagation();
          reelMenu.style.display = 'none';
          const videoSrc = getFbVideoSrc();
          if (videoSrc && !videoSrc.startsWith('blob:')) {
            showToast('Descargando Reel directamente...', 'info', 2500);
            chrome.runtime.sendMessage({
              type: 'DOWNLOAD_FILE',
              url: videoSrc,
              fileName: `facebook_reel_${Date.now()}.mp4`,
              saveAs: false
            });
          } else {
            showToast('Procesando video vía backend...', 'info', 2500);
            startBackendDownload({
              url: window.location.href,
              type: 'video',
              format: 'mp4',
              quality: 'best',
              title: `Facebook Reel ${Date.now()}`
            });
          }
        });

        // Backend Video
        reelMenu.querySelector('#ytdl-fb-reel-backend').addEventListener('click', (e) => {
          e.stopPropagation();
          reelMenu.style.display = 'none';
          startBackendDownload({
            url: window.location.href,
            type: 'video',
            format: 'mp4',
            quality: 'best',
            title: `Facebook Reel ${Date.now()}`
          });
        });

        // Backend Audio
        reelMenu.querySelector('#ytdl-fb-reel-audio').addEventListener('click', (e) => {
          e.stopPropagation();
          reelMenu.style.display = 'none';
          startBackendDownload({
            url: window.location.href,
            type: 'audio',
            format: 'mp3',
            quality: '320k',
            title: `Facebook Reel Audio ${Date.now()}`
          });
        });

        reelWrapper.appendChild(reelBtn);
        reelWrapper.appendChild(reelLabel);
        reelWrapper.appendChild(reelMenu);
        actionGroup.appendChild(reelWrapper);
      });
    }

    // B) Feed Videos & Watch Pages
    const videoContainers = document.querySelectorAll('div[role="article"]:not(.ytdl-fb-processed), div[data-pagelet*="FeedUnit"]:not(.ytdl-fb-processed), div[role="main"]:not(.ytdl-fb-processed)');
    videoContainers.forEach((container) => {
      const videoEl = container.querySelector('video');
      if (!videoEl) return;

      const shareIcon = container.querySelector('svg[aria-label="Compartir"], svg[aria-label="Share"], svg[aria-label="Enviar"], svg[aria-label="Send"]');
      const actionRow = shareIcon?.closest('div[role="button"]')?.parentNode || container.querySelector('div[role="toolbar"]');
      if (!actionRow || actionRow.querySelector('.ytdl-fb-post-btn-wrapper')) return;

      container.classList.add('ytdl-fb-processed');

      const wrapper = document.createElement('div');
      wrapper.className = 'ytdl-fb-post-btn-wrapper';

      const fbBtn = document.createElement('button');
      fbBtn.className = 'ytdl-fb-post-btn';
      fbBtn.title = 'Descargar video de Facebook';
      fbBtn.innerHTML = `
        <svg viewBox="0 0 24 24">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
        </svg>
        <span>Descargar</span>
      `;

      const fbMenu = document.createElement('div');
      fbMenu.className = 'ytdl-fb-menu';
      fbMenu.style.display = 'none';
      fbMenu.innerHTML = `
        <button class="ytdl-menu-item" id="ytdl-fb-post-direct">
          <span class="icon">⚡</span>
          <span>Descarga Rápida (Directo)</span>
        </button>
        <button class="ytdl-menu-item" id="ytdl-fb-post-backend">
          <span class="icon">📹</span>
          <span>Video MP4 HD (Backend)</span>
        </button>
        <button class="ytdl-menu-item" id="ytdl-fb-post-audio">
          <span class="icon">🎵</span>
          <span>Audio MP3 (Backend)</span>
        </button>
      `;

      fbBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const isVisible = fbMenu.style.display === 'flex';
        fbMenu.style.display = isVisible ? 'none' : 'flex';
        activeDropdown = isVisible ? null : fbMenu;
      });

      const getTargetUrl = () => {
        const permalink = container.querySelector('a[href*="/videos/"], a[href*="/watch"], a[href*="/reel/"]');
        if (permalink && permalink.href) {
          return permalink.href;
        }
        return window.location.href;
      };

      // Direct download
      fbMenu.querySelector('#ytdl-fb-post-direct').addEventListener('click', (e) => {
        e.stopPropagation();
        fbMenu.style.display = 'none';
        const vSrc = videoEl.currentSrc || videoEl.src;
        if (vSrc && !vSrc.startsWith('blob:')) {
          showToast('Descargando video directamente...', 'info', 2500);
          chrome.runtime.sendMessage({
            type: 'DOWNLOAD_FILE',
            url: vSrc,
            fileName: `facebook_video_${Date.now()}.mp4`,
            saveAs: false
          });
        } else {
          startBackendDownload({
            url: getTargetUrl(),
            type: 'video',
            format: 'mp4',
            quality: 'best',
            title: `Facebook Video ${Date.now()}`
          });
        }
      });

      // Backend download
      fbMenu.querySelector('#ytdl-fb-post-backend').addEventListener('click', (e) => {
        e.stopPropagation();
        fbMenu.style.display = 'none';
        startBackendDownload({
          url: getTargetUrl(),
          type: 'video',
          format: 'mp4',
          quality: 'best',
          title: `Facebook Video ${Date.now()}`
        });
      });

      // Audio download
      fbMenu.querySelector('#ytdl-fb-post-audio').addEventListener('click', (e) => {
        e.stopPropagation();
        fbMenu.style.display = 'none';
        startBackendDownload({
          url: getTargetUrl(),
          type: 'audio',
          format: 'mp3',
          quality: '320k',
          title: `Facebook Audio ${Date.now()}`
        });
      });

      wrapper.appendChild(fbBtn);
      wrapper.appendChild(fbMenu);
      actionRow.appendChild(wrapper);
    });
  }

  // -------------------------------------------------------------
  // 8. Route and Run Injections
  // -------------------------------------------------------------
  function scanAndInject() {
    const host = window.location.hostname;

    if (host.includes('youtube.com')) {
      if (window.location.pathname.startsWith('/watch')) {
        injectYouTubeWatchButton();
      } else if (window.location.pathname.startsWith('/shorts')) {
        injectYouTubeShortsButton();
      }
    } else if (host.includes('instagram.com')) {
      injectInstagramButtons();
    } else if (host.includes('facebook.com') || host.includes('fb.watch')) {
      injectFacebookButtons();
    }
  }

  // Run on page events
  window.addEventListener('yt-navigate-finish', () => {
    setTimeout(scanAndInject, 600);
  });

  window.addEventListener('popstate', () => {
    setTimeout(scanAndInject, 600);
  });

  // Debounced MutationObserver for dynamic SPAs
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanAndInject, 500);
  });

  observer.observe(document.body, { childList: true, subtree: true });

  // Initial runs
  setTimeout(scanAndInject, 800);
  setTimeout(scanAndInject, 2000);
})();
