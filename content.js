/**
 * HiRes - Content Script
 * Extracts high-resolution image URLs from Google Images using "Ghost Click" approach
 *
 * Strategy: Programmatically trigger Google's preview panel (hidden via CSS),
 * wait for the high-res image to load, extract the URL, then cleanup.
 *
 * @see README.md for known issues and contributing guidelines
 */

(function () {
  'use strict';

  // Set to true to enable debug logging
  const DEBUG = false;

  const log = (...args) => DEBUG && console.log('[HiRes]', ...args);
  const logError = (...args) => console.error('[HiRes]', ...args);

  let lastRightClickedElement = null;

  // CSS to completely hide preview panel during extraction
  const HIDE_PREVIEW_CSS = `
    #islsp, .islsp, .v4dQwb, [role="region"], [jsname="CGzTgf"],
    .pxAole, .tvh9oe, .immersive-container, div[data-ved][role="dialog"] {
      opacity: 0.01 !important;
      pointer-events: none !important;
      position: fixed !important;
      top: -9999px !important;
      left: -9999px !important;
    }
  `;

  /**
   * Inject hiding CSS
   */
  function injectHideStyle() {
    const style = document.createElement('style');
    style.id = 'hires-hide-preview';
    style.textContent = HIDE_PREVIEW_CSS;
    document.head.appendChild(style);
    return style;
  }

  /**
   * Remove hiding CSS
   */
  function removeHideStyle(style) {
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  /**
   * Close preview panel
   */
  function closePreviewPanel() {
    // Method 1: Escape key
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true
    }));

    // Method 2: Click close button
    const closeBtn = document.querySelector('[aria-label="Close"], [aria-label="close"], .hm60ue');
    if (closeBtn) closeBtn.click();

    // Method 3: Click body
    document.body.click();
  }

  /**
   * Check if URL is valid high-res (not Google thumbnail)
   */
  function isValidHighResUrl(src) {
    if (!src) return false;
    const lower = src.toLowerCase();
    return src.startsWith('http') &&
           !lower.includes('data:image') &&
           !lower.includes('base64') &&
           !lower.includes('gstatic.com') &&
           !lower.includes('googleusercontent.com') &&
           !lower.includes('encrypted-tbn') &&
           !lower.includes('ggpht.com') &&
           !lower.includes('googleapis.com');
  }

  /**
   * Trigger Google's preview with full interaction sequence
   */
  function triggerGooglePreview(thumbnail) {
    const rect = thumbnail.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    };

    // Full physical interaction sequence
    thumbnail.dispatchEvent(new PointerEvent('pointerdown', { ...opts, isPrimary: true }));
    thumbnail.dispatchEvent(new MouseEvent('mousedown', opts));
    thumbnail.dispatchEvent(new PointerEvent('pointerup', { ...opts, isPrimary: true }));
    thumbnail.dispatchEvent(new MouseEvent('mouseup', opts));
    thumbnail.click();
  }

  /**
   * Wait for high-res image with setInterval (50ms checks, max 2.5 seconds)
   */
  function waitForHighResImage() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const maxWait = 2500;

      // Primary selectors for Google's large preview image (Dec 2025)
      const primarySelectors = [
        'img[jsname="cpNoic"]',     // Primary large image
        'img.s699le',                // Alternative class
        'img[jsname="kn3ccd"]',      // Another jsname variant
        'img[jsname="HiaYvf"]',      // Yet another variant
        'img.sFlh5c.FyHeAf',         // Class-based selector
        'img.n3VNCb',                // Common preview class
        'img.iPVvYb',                // Another preview class
      ];

      const checkInterval = setInterval(() => {
        // Check if timeout
        if (Date.now() - startTime > maxWait) {
          clearInterval(checkInterval);
          log('Timeout waiting for preview image');
          resolve(null);
          return;
        }

        // Try primary selectors first
        for (const selector of primarySelectors) {
          const img = document.querySelector(selector);
          if (img) {
            const src = img.src || img.getAttribute('data-src');
            if (isValidHighResUrl(src)) {
              clearInterval(checkInterval);
              log('Found via selector', selector);
              resolve(src);
              return;
            }
          }
        }

        // Fallback: Find largest valid image on page
        let bestUrl = null;
        let bestWidth = 0;

        const allImages = document.querySelectorAll('img');
        for (const img of allImages) {
          const src = img.src;
          if (isValidHighResUrl(src)) {
            const width = img.naturalWidth || img.width || 0;
            if (width > 500 && width > bestWidth) {
              bestUrl = src;
              bestWidth = width;
            }
          }
        }

        if (bestUrl && bestWidth > 600) {
          clearInterval(checkInterval);
          log('Found large image', bestWidth, 'px');
          resolve(bestUrl);
          return;
        }

        // Check for imgurl= links in preview panel
        const imgLinks = document.querySelectorAll('[role="region"] a[href*="imgurl="], #islsp a[href*="imgurl="]');
        for (const link of imgLinks) {
          try {
            const url = new URL(link.href);
            const imgurl = url.searchParams.get('imgurl');
            if (imgurl && isValidHighResUrl(imgurl)) {
              clearInterval(checkInterval);
              const decoded = decodeURIComponent(imgurl);
              log('Found via imgurl link');
              resolve(decoded);
              return;
            }
          } catch (e) {}
        }

      }, 50); // Check every 50ms
    });
  }

  /**
   * Main Ghost Click extraction
   */
  async function ghostClickAndExtract(thumbnailElement) {
    log('Starting extraction...');

    // Find clickable element
    const clickable = thumbnailElement.closest('a') ||
                      thumbnailElement.closest('[jsaction*="click"]') ||
                      thumbnailElement.closest('[data-ved]') ||
                      thumbnailElement;

    if (!clickable) {
      log('No clickable element found');
      return null;
    }

    // Step 1: Inject hiding CSS
    const hideStyle = injectHideStyle();
    log('Preview panel hidden');

    try {
      // Step 2: Trigger preview with full interaction sequence
      log('Triggering preview...');
      triggerGooglePreview(clickable);

      // Step 3: Wait for high-res image to appear
      const highResUrl = await waitForHighResImage();

      // Step 4: Close preview
      closePreviewPanel();
      await new Promise(r => setTimeout(r, 50));

      return highResUrl;

    } finally {
      // Step 5: Always cleanup
      removeHideStyle(hideStyle);
      log('Cleanup complete');
    }
  }

  /**
   * Strip sizing parameters
   */
  function stripSizingParameters(url) {
    if (!url) return url;
    return url
      .replace(/=w\d+(-h\d+)?(-[a-z-]+)?$/i, '')
      .replace(/=s\d+(-[a-z-]+)?$/i, '')
      .replace(/=h\d+(-[a-z-]+)?$/i, '');
  }

  /**
   * Capture right-click
   */
  document.addEventListener('contextmenu', (event) => {
    lastRightClickedElement = event.target;
    log('Right-click captured');
  }, true);

  /**
   * Handle messages from background
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getOriginalUrl') {
      log('Received extraction request');

      let targetElement = lastRightClickedElement;

      // Fallback: find by thumbnail URL
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
        log('No target element');
        sendResponse({ originalUrl: null });
        return true;
      }

      // Execute Ghost Click
      (async () => {
        try {
          const highResUrl = await ghostClickAndExtract(targetElement);

          if (highResUrl) {
            const finalUrl = stripSizingParameters(highResUrl);
            log('Success:', finalUrl.substring(0, 50) + '...');
            sendResponse({ originalUrl: finalUrl });
          } else {
            log('Failed - No URL found');
            sendResponse({ originalUrl: null });
          }
        } catch (error) {
          logError('Extraction error:', error.message);
          sendResponse({ originalUrl: null });
        }
      })();

      return true;
    }
    return false;
  });

  log('Content script loaded');
})();
