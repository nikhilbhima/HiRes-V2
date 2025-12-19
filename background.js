/**
 * HiRes - Background Service Worker
 * Handles context menu creation and coordinates with content script
 */

const CONTEXT_MENU_ID = 'hires-open-original';

// Create context menu on extension install/update
chrome.runtime.onInstalled.addListener(() => {
  // Remove existing menu items first to avoid duplicate ID error
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: 'Open with HiRes',
    contexts: ['image'],
    documentUrlPatterns: [
      'https://www.google.com/search*',
      'https://www.google.co.uk/search*',
      'https://www.google.co.jp/search*',
      'https://www.google.co.in/search*',
      'https://www.google.co.kr/search*',
      'https://www.google.co.nz/search*',
      'https://www.google.co.za/search*',
      'https://www.google.co.th/search*',
      'https://www.google.co.id/search*',
      'https://www.google.com.au/search*',
      'https://www.google.com.br/search*',
      'https://www.google.com.mx/search*',
      'https://www.google.com.ar/search*',
      'https://www.google.com.sg/search*',
      'https://www.google.com.hk/search*',
      'https://www.google.com.tr/search*',
      'https://www.google.com.ph/search*',
      'https://www.google.com.vn/search*',
      'https://www.google.com.my/search*',
      'https://www.google.ca/search*',
      'https://www.google.de/search*',
      'https://www.google.fr/search*',
      'https://www.google.es/search*',
      'https://www.google.it/search*',
      'https://www.google.ru/search*',
      'https://www.google.nl/search*',
      'https://www.google.pl/search*',
      'https://www.google.se/search*',
      'https://www.google.ch/search*',
      'https://www.google.at/search*',
      'https://www.google.be/search*',
      'https://www.google.pt/search*',
      'https://www.google.ae/search*'
    ]
    });
  });
});

// Handle context menu click
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;

  const thumbnailUrl = info.srcUrl;

  if (!thumbnailUrl) {
    console.error('HiRes: No image URL found');
    return;
  }

  // Check if this is a Google Images page (has tbm=isch in URL)
  if (!tab.url || !isGoogleImagesUrl(tab.url)) {
    // Not on Google Images, just open the thumbnail URL
    chrome.tabs.create({ url: thumbnailUrl });
    return;
  }

  try {
    // Request original URL from content script
    const response = await chrome.tabs.sendMessage(tab.id, {
      action: 'getOriginalUrl',
      thumbnailUrl: thumbnailUrl
    });

    if (response && response.originalUrl) {
      chrome.tabs.create({ url: response.originalUrl });
    } else {
      // Fallback: open thumbnail URL
      console.warn('HiRes: Original URL not found, opening thumbnail');
      chrome.tabs.create({ url: thumbnailUrl });
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

      // Retry after injection
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'getOriginalUrl',
        thumbnailUrl: thumbnailUrl
      });

      if (response && response.originalUrl) {
        chrome.tabs.create({ url: response.originalUrl });
      } else {
        chrome.tabs.create({ url: thumbnailUrl });
      }
    } catch (retryError) {
      console.error('HiRes: Retry failed:', retryError);
      chrome.tabs.create({ url: thumbnailUrl });
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
