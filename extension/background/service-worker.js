/**
 * YouTube Downloader & Converter Pro - Background Service Worker
 * Manifest V3 compliant (ephemeral, state in chrome.storage.local)
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
    title: title || 'YouTube Downloader',
    message: message || '',
    priority: 2
  });
}

// Message handler for communication between popup / content script and service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
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
            message.error || 'Ocurrió un error inesperado al procesar el video.',
            true
          );
          setTimeout(() => setBadge(''), 6000);
          sendResponse({ success: true });
          break;
        }

        case 'DOWNLOAD_FILE': {
          const downloadOptions = {
            url: message.url,
            filename: message.fileName || undefined,
            saveAs: message.saveAs ?? true
          };

          chrome.downloads.download(downloadOptions, (downloadId) => {
            if (chrome.runtime.lastError) {
              console.error('Download error:', chrome.runtime.lastError);
              sendResponse({ success: false, error: chrome.runtime.lastError.message });
            } else {
              sendResponse({ success: true, downloadId });
            }
          });
          return; // Asynchronous callback already handles sendResponse
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
