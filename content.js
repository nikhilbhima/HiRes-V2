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
   * Extract high-res URL from the preview panel
   * Waits for the large image to load with a real URL
   */
  async function extractFromPreviewPanel(maxWaitMs = 3000) {
    const startTime = Date.now();

    // Selectors for the large preview image
    const previewImageSelectors = [
      // Primary selectors for the large preview image
      '[jsname="kn3ccd"]',           // Large image jsname
      '[jsname="HiaYvf"]',           // Alternative jsname
      'img.sFlh5c.FyHeAf',           // Large image classes
      'img.n3VNCb',                  // Another common class
      'img.iPVvYb',                  // Yet another class
      '[data-noaft] img',            // Container with data-noaft
      '.tvh9oe img',                 // Preview container image
      '[role="dialog"] img',         // Dialog image
      'c-wiz[data-p] img',           // c-wiz container image
    ];

    while (Date.now() - startTime < maxWaitMs) {
      // Try each selector
      for (const selector of previewImageSelectors) {
        const imgs = document.querySelectorAll(selector);

        for (const img of imgs) {
          const src = img.src || img.getAttribute('src');

          // Check if it's a valid high-res URL (not base64, not Google thumbnail)
          if (src &&
              src.startsWith('http') &&
              !src.includes('base64') &&
              !src.includes('data:image') &&
              !src.includes('gstatic.com') &&
              !src.includes('googleusercontent.com') &&
              !src.includes('encrypted-tbn') &&
              !src.includes('ggpht.com')) {

            // Check image dimensions - preview image should be large
            if (img.naturalWidth > 200 || img.width > 200) {
              console.log('HiRes: ✅ Found high-res URL in preview:', src);
              return src;
            }
          }
        }
      }

      // Also check for "Open image in new tab" links
      const linkSelectors = [
        'a[href*="imgurl="]',
        'a[aria-label*="image"]',
        'a[href^="http"]:not([href*="google"])'
      ];

      for (const selector of linkSelectors) {
        const links = document.querySelectorAll(selector);
        for (const link of links) {
          // Check if this is the "open original" link
          if (link.href && link.href.includes('imgurl=')) {
            const url = new URL(link.href);
            const imgurl = url.searchParams.get('imgurl');
            if (imgurl && !imgurl.includes('gstatic') && !imgurl.includes('googleusercontent')) {
              console.log('HiRes: ✅ Found high-res URL in link:', imgurl);
              return decodeURIComponent(imgurl);
            }
          }
        }
      }

      // Wait 100ms before next check
      await new Promise(r => setTimeout(r, 100));
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
