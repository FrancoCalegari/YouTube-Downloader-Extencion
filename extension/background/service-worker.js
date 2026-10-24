/**
 * YouTube Downloader & Converter Pro - Background Service Worker
 * Manifest V3 compliant (ephemeral, state in chrome.storage.local)
 * Handles backend communication, download streams, badges, and Chrome downloads API.
 */

const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:23458',
  preferredType: 'video',
  preferredVideoQuality: 'best',
  preferredVideoFormat: 'mp4',
  preferredAudioFormat: 'mp3',
  preferredAudioBitrate: '320k',
  autoSave: true
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async (details) => {
  const current = await chrome.storage.local.get('settings');
  if (!current.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  console.log('YouTube Downloader extension installed/updated:', details.reason);
});

// Update badge helper
async function setBadge(text, color = '#FF0033') {
  await chrome.action.setBadgeText({ text: text || '' });
  if (color) {
    await chrome.action.setBadgeBackgroundColor({ color });
  }
}

// Show notification helper
function showNotification(title, message, isError = false) {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
    title: title || 'Multi Downloader (YT, IG & Facebook)',
    message: message || '',
    priority: 2
  });
}

// Stream and track job progress from backend
async function trackJobSSE(jobId, tabId, meta) {
  const serverUrl = DEFAULT_SETTINGS.serverUrl;
  try {
    const response = await fetch(`${serverUrl}/api/progress/${jobId}`);
    if (!response.ok || !response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop(); // keep partial

      for (const part of parts) {
        const lines = part.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            try {
              const data = JSON.parse(trimmed.replace(/^data:\s*/, ''));
              await handleJobProgressUpdate(data, tabId, meta);
              if (['ready', 'error', 'cancelled', 'expired'].includes(data.status)) {
                return;
              }
            } catch (e) {
              console.error('SSE parse error in service worker:', e);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('SSE tracking failed in service worker:', err);
  }
}

async function handleJobProgressUpdate(data, tabId, meta) {
  const pct = Math.round(data.percent || 0);

  // Notify tab if sender tab is available
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'DOWNLOAD_JOB_UPDATE',
      data
    }).catch(() => {});
  }

  if (data.status === 'downloading') {
    await setBadge(`${pct}%`, meta.type === 'audio' ? '#8b5cf6' : '#FF0033');
  } else if (data.status === 'converting') {
    await setBadge('CONV', '#7928CA');
  } else if (data.status === 'ready') {
    await setBadge('✓', '#10B981');
    const downloadUrl = `${DEFAULT_SETTINGS.serverUrl}${data.downloadUrl}`;
    const fileName = data.fileName || `${meta.title || 'media'}.${meta.format || 'mp4'}`;

    showNotification(
      '¡Descarga Completada!',
      `"${fileName}" está listo y guardándose en tu equipo.`
    );

    // Save through Chrome Downloads API
    chrome.downloads.download({
      url: downloadUrl,
      filename: fileName,
      saveAs: false
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        chrome.downloads.download({ url: downloadUrl, filename: fileName, saveAs: true });
      }
    });

    setTimeout(() => setBadge(''), 7000);
  } else if (data.status === 'error') {
    await setBadge('!', '#EF4444');
    showNotification('Error en la descarga', data.error || 'Ocurrió un error inesperado al procesar.', true);
    setTimeout(() => setBadge(''), 7000);
  }
}

// Message handler for communication between popup / content script and service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'CHECK_BACKEND': {
          try {
            const res = await fetch(`${DEFAULT_SETTINGS.serverUrl}/api/health`, { method: 'GET' });
            if (res.ok) {
              const data = await res.json().catch(() => ({}));
              sendResponse({ success: true, online: true, data });
            } else {
              sendResponse({ success: false, online: false });
            }
          } catch {
            sendResponse({ success: false, online: false });
          }
          break;
        }

        case 'START_BACKEND_DOWNLOAD': {
          try {
            const payload = message.payload || {};
            const res = await fetch(`${DEFAULT_SETTINGS.serverUrl}/api/download`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });

            if (!res.ok) {
              const errData = await res.json().catch(() => ({}));
              sendResponse({ success: false, error: errData.error || 'No se pudo iniciar la descarga en el backend' });
              break;
            }

            const { jobId } = await res.json();
            sendResponse({ success: true, jobId });

            const tabId = sender.tab ? sender.tab.id : null;
            trackJobSSE(jobId, tabId, payload);
          } catch (err) {
            console.error('Error in START_BACKEND_DOWNLOAD:', err);
            sendResponse({ success: false, error: err.message });
          }
          break;
        }

        case 'GET_SETTINGS': {
          const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
          sendResponse({ success: true, settings });
          break;
        }

        case 'SAVE_SETTINGS': {
          await chrome.storage.local.set({ settings: message.settings });
          sendResponse({ success: true });
          break;
        }

        case 'UPDATE_BADGE': {
          await setBadge(message.text, message.color);
          sendResponse({ success: true });
          break;
        }

        case 'NOTIFY_COMPLETED': {
          await setBadge('✓', '#10B981');
          showNotification(
            '¡Descarga Completada!',
            `"${message.fileName || 'Tu archivo'}" está listo para guardar.`
          );
          setTimeout(() => setBadge(''), 6000);
          sendResponse({ success: true });
          break;
        }

        case 'NOTIFY_ERROR': {
          await setBadge('!', '#EF4444');
          showNotification(
            'Error en la descarga',
            message.error || 'Ocurrió un error inesperado al procesar.',
            true
          );
          setTimeout(() => setBadge(''), 6000);
          sendResponse({ success: true });
          break;
        }

        case 'DOWNLOAD_FILE': {
          const cleanName = (message.fileName || 'media_download')
            .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
            .trim();
          const downloadOptions = {
            url: message.url,
            filename: cleanName || undefined,
            saveAs: message.saveAs ?? false
          };

          chrome.downloads.download(downloadOptions, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('Download error:', chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, downloadId });
            }
          });
          return; // Async callback handles sendResponse
        }

        default:
          sendResponse({ success: false, error: 'Unknown message type' });
      }
    } catch (err) {
      console.error('Service worker error:', err);
      sendResponse({ success: false, error: err.message });
    }
  })();

  return true; // Keep channel open for async response
});
