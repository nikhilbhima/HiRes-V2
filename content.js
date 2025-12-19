/**
 * HiRes - Content Script
 * "Ghost Click" approach - clicks thumbnail, extracts from hidden preview panel
 * Updated December 2025
 */

(function () {
  'use strict';

  // Store the last right-clicked element
  let lastRightClickedElement = null;

  // CSS to hide the preview panel during extraction
  const HIDE_PREVIEW_CSS = `
    /* Hide Google Images preview panel so user doesn't see it */
    #islsp,
    .islsp,
    [jsname="CGzTgf"],
    [data-ved][role="dialog"],
    .pxAole,
    .tvh9oe,
    .immersive-container {
      opacity: 0 !important;
      pointer-events: none !important;
    }
  `;

  /**
   * Inject CSS to hide the preview panel
   */
  function injectHideStyle() {
    const style = document.createElement('style');
    style.id = 'hires-hide-preview';
    style.textContent = HIDE_PREVIEW_CSS;
    document.head.appendChild(style);
    return style;
  }

  /**
   * Remove the hide style
   */
  function removeHideStyle(style) {
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  /**
   * Close the preview panel
   */
  function closePreviewPanel() {
    // Try various close methods

    // Method 1: Press Escape
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true
    }));

    // Method 2: Click close button
    const closeSelectors = [
      '[aria-label="Close"]',
      '[aria-label="close"]',
      '.hm60ue', // Close button class
      'button[jsaction*="close"]',
      '.Q4iAWc'
    ];

    for (const selector of closeSelectors) {
      const closeBtn = document.querySelector(selector);
      if (closeBtn) {
        closeBtn.click();
        break;
      }
    }

    // Method 3: Click outside the panel
    document.body.click();
  }

  /**
   * Check if URL is a valid high-res source (not Google thumbnail)
   */
  function isValidHighResUrl(src) {
    if (!src) return false;
    if (!src.startsWith('http')) return false;

    const lower = src.toLowerCase();
    return !lower.includes('base64') &&
           !lower.includes('data:image') &&
           !lower.includes('gstatic.com') &&
           !lower.includes('googleusercontent.com') &&
           !lower.includes('encrypted-tbn') &&
           !lower.includes('ggpht.com') &&
           !lower.includes('googleapis.com') &&
           !lower.includes('/th?') &&  // Google thumbnail URL pattern
           !lower.includes('=s') &&    // Google sizing parameter
           lower.length > 50;          // Real URLs tend to be longer
  }

  /**
   * Extract high-res URL from the preview panel
   * Waits for the large image to load with a real URL
   */
  async function extractFromPreviewPanel(maxWaitMs = 5000) {
    const startTime = Date.now();
    let bestUrl = null;
    let bestWidth = 0;

    console.log('HiRes: Scanning for preview image...');

    while (Date.now() - startTime < maxWaitMs) {
      // Method 1: Look for ALL images on page and find the largest valid one
      const allImages = document.querySelectorAll('img');

      for (const img of allImages) {
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-iurl');

        if (isValidHighResUrl(src)) {
          // Check actual rendered/natural dimensions
          const width = img.naturalWidth || img.width || 0;
          const height = img.naturalHeight || img.height || 0;

          // We want the largest image that's not the thumbnail grid
          if (width > 400 && width > bestWidth) {
            bestUrl = src;
            bestWidth = width;
            console.log(`HiRes: Found candidate [${width}x${height}]: ${src.substring(0, 80)}...`);
          }
        }
      }

      // Method 2: Check data-iurl attributes (Google sometimes stores URL here)
      const elementsWithDataUrl = document.querySelectorAll('[data-iurl], [data-ou], [data-src]');
      for (const el of elementsWithDataUrl) {
        const src = el.getAttribute('data-iurl') || el.getAttribute('data-ou') || el.getAttribute('data-src');
        if (isValidHighResUrl(src)) {
          console.log('HiRes: Found URL in data attribute:', src.substring(0, 80));
          if (!bestUrl || src.length > bestUrl.length) {
            bestUrl = src;
          }
        }
      }

      // Method 3: Check for links with imgurl parameter
      const imgLinks = document.querySelectorAll('a[href*="imgurl="]');
      for (const link of imgLinks) {
        try {
          const url = new URL(link.href);
          const imgurl = url.searchParams.get('imgurl');
          if (imgurl && isValidHighResUrl(imgurl)) {
            const decoded = decodeURIComponent(imgurl);
            console.log('HiRes: Found URL in imgurl link:', decoded.substring(0, 80));
            if (!bestUrl || decoded.length > bestUrl.length) {
              bestUrl = decoded;
            }
          }
        } catch (e) {}
      }

      // Method 4: Check elements with specific jsname attributes
      const jsNameSelectors = ['[jsname="kn3ccd"]', '[jsname="HiaYvf"]', '[jsname="Q4LuWd"]'];
      for (const selector of jsNameSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          const src = el.src || el.getAttribute('data-src');
          if (isValidHighResUrl(src)) {
            console.log('HiRes: Found URL via jsname:', src.substring(0, 80));
            return src;
          }
        }
      }

      // If we found a good candidate with width > 600, use it
      if (bestUrl && bestWidth > 600) {
        console.log('HiRes: ✅ Using best candidate:', bestUrl.substring(0, 80));
        return bestUrl;
      }

      // Wait 150ms before next scan
      await new Promise(r => setTimeout(r, 150));
    }

    // Return whatever we found, even if not ideal
    if (bestUrl) {
      console.log('HiRes: ✅ Using best found URL:', bestUrl.substring(0, 80));
      return bestUrl;
    }

    console.log('HiRes: ❌ Could not find high-res URL in preview panel');
    return null;
  }

  /**
   * The main "Ghost Click" function
   * Clicks thumbnail invisibly, extracts URL from preview, cleans up
   */
  async function ghostClickAndExtract(thumbnailElement) {
    console.log('HiRes: Starting Ghost Click extraction');

    // Step 1: Find the clickable element
    const clickable = thumbnailElement.closest('a') ||
                      thumbnailElement.closest('[jsaction*="click"]') ||
                      thumbnailElement.closest('[data-ved]') ||
                      thumbnailElement;

    if (!clickable) {
      console.log('HiRes: No clickable element found');
      return null;
    }

    // Step 2: Inject CSS to hide the preview panel
    const hideStyle = injectHideStyle();
    console.log('HiRes: Preview panel hidden');

    try {
      // Step 3: Click the thumbnail to open preview
      console.log('HiRes: Clicking thumbnail...');
      clickable.click();

      // Step 4: Wait for preview to load and extract URL
      const highResUrl = await extractFromPreviewPanel(3000);

      // Step 5: Close the preview panel
      closePreviewPanel();

      // Small delay to ensure panel closes
      await new Promise(r => setTimeout(r, 100));

      return highResUrl;

    } finally {
      // Step 6: Always remove the hide style
      removeHideStyle(hideStyle);
      console.log('HiRes: Cleanup complete');
    }
  }

  /**
   * Strip sizing parameters from URL
   */
  function stripSizingParameters(url) {
    if (!url) return url;
    return url
      .replace(/=w\d+(-h\d+)?(-[a-z-]+)?$/i, '')
      .replace(/=s\d+(-[a-z-]+)?$/i, '')
      .replace(/=h\d+(-[a-z-]+)?$/i, '');
  }

  /**
   * Capture right-click target
   */
  document.addEventListener('contextmenu', (event) => {
    lastRightClickedElement = event.target;
    console.log('HiRes: Right-click captured on:', event.target.tagName);
  }, true);

  /**
   * Handle messages from background script
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getOriginalUrl') {
      console.log('HiRes: Received request for original URL');

      // Use the captured element from right-click
      let targetElement = lastRightClickedElement;

      // Fallback: try to find element by thumbnail URL
      if (!targetElement && message.thumbnailUrl) {
        targetElement = document.querySelector(`img[src="${message.thumbnailUrl}"]`);
        if (!targetElement) {
          const imgs = document.querySelectorAll('img[src*="encrypted-tbn"]');
          for (const img of imgs) {
            if (message.thumbnailUrl.includes(img.src) || img.src.includes(message.thumbnailUrl)) {
              targetElement = img;
              break;
            }
          }
        }
      }

      if (!targetElement) {
        console.log('HiRes: No target element found');
        sendResponse({ originalUrl: null });
        return true;
      }

      // Use Ghost Click approach
      (async () => {
        try {
          const highResUrl = await ghostClickAndExtract(targetElement);

          if (highResUrl) {
            const finalUrl = stripSizingParameters(highResUrl);
            console.log('HiRes: ✅ SUCCESS - Final URL:', finalUrl);
            sendResponse({ originalUrl: finalUrl });
          } else {
            console.log('HiRes: ❌ FAILED - No URL found');
            sendResponse({ originalUrl: null });
          }
        } catch (error) {
          console.error('HiRes: Error during extraction:', error);
          sendResponse({ originalUrl: null });
        }
      })();

      return true; // Keep message channel open for async response
    }

    return false;
  });

  console.log('HiRes: Content script loaded (Ghost Click approach - December 2025)');
})();
