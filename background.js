/**
 * HiRes - Background Service Worker
 * Handles context menu creation and coordinates with content script
 */

const CONTEXT_MENU_ID = 'hires-open-original';

// Create context menu on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  // Remove existing menu items first to avoid duplicate ID error
  chrome.contextMenus.removeAll(() => {
    // 1. Open Original
    chrome.contextMenus.create({
      id: CONTEXT_MENU_ID,
      title: 'Open with HiRes',
      contexts: ['image'],
      documentUrlPatterns: [
        'https://www.google.com/*', 'https://google.com/*',
        'https://www.google.co.uk/*', 'https://www.google.co.jp/*',
        'https://www.google.ca/*', 'https://www.google.de/*',
        'http://*/*', 'https://*/*' // Enable everywhere for fallback to thumbnail
      ]
    });

    // 2. AI Upscale (New)
    chrome.contextMenus.create({
      id: 'hires-upscale',
      title: 'Upscale with HiRes',
      contexts: ['image'],
      documentUrlPatterns: ['<all_urls>'] // Allow upscaling anywhere
    });
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const action = info.menuItemId;
  if (action !== CONTEXT_MENU_ID && action !== 'hires-upscale') return;

  const thumbnailUrl = info.srcUrl;

  if (!thumbnailUrl) {
    console.error('HiRes: No image URL found');
    return;
  }

  // --- HELPER: Logic to decide what to do with the final URL ---
  const handleFinalUrl = (url) => {
    if (action === 'hires-upscale') {
      // Open Upscale Studio
      chrome.tabs.create({ 
        url: chrome.runtime.getURL(`upscale.html?img=${encodeURIComponent(url)}`) 
      });
    } else {
      // Just Open Image (Original HiRes behavior)
      chrome.tabs.create({ url: url });
    }
  };

  // Check if this is a Google Images page (has tbm=isch in URL)
  if (!tab.url || !isGoogleImagesUrl(tab.url)) {
    // Not on Google Images? directly upscale/open the thumbnail
    handleFinalUrl(thumbnailUrl);
    return;
  }

  try {
    // Request original URL from content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getOriginalUrl',
      thumbnailUrl: thumbnailUrl
    });

    if (response && response.originalUrl) {
      handleFinalUrl(response.originalUrl);
    } else {
      // Fallback: use thumbnail URL
      console.warn('HiRes: Original URL not found, using thumbnail');
      handleFinalUrl(thumbnailUrl);
    }
  } catch (error) {
    // Content script not ready or error occurred
    console.error('HiRes: Error communicating with content script:', error);

    // Try to inject content script and retry
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });

      // Wait for script to initialize
      await new Promise(r => setTimeout(r, 100));

      // Retry after injection
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getOriginalUrl',
        thumbnailUrl: thumbnailUrl
      });

      if (response && response.originalUrl) {
        handleFinalUrl(response.originalUrl);
      } else {
        handleFinalUrl(thumbnailUrl);
      }
    } catch (retryError) {
      console.error('HiRes: Retry failed:', retryError);
      handleFinalUrl(thumbnailUrl);
    }
  }
});

/**
 * Check if URL is a Google Images search page
 */
function isGoogleImagesUrl(url) {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    const searchParams = urlObj.searchParams;

    // Check if it's a Google domain
    const isGoogleDomain = hostname.match(/^www\.google\.(com|co\.\w+|com\.\w+)$/);
    if (!isGoogleDomain) return false;

    // Check if it's an image search (tbm=isch)
    return searchParams.get('tbm') === 'isch' ||
           searchParams.get('udm') === '2'; // New Google Images param
  } catch {
    return false;
  }
}
