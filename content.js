/**
 * HiRes - Content Script
 * Click-and-extract approach - triggers Google's preview panel to get the high-res URL
 */

(function () {
  'use strict';

  const DEBUG = false;
  const log = (...args) => DEBUG && console.log('[HiRes]', ...args);

  let lastRightClickedElement = null;

  /**
   * Check if URL is a direct image file URL (not a webpage)
   */
  function isDirectImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('http')) return false;
    if (url.startsWith('data:')) return false;

    // Block Google's own thumbnails
    if (url.includes('encrypted-tbn')) return false;
    if (url.includes('gstatic.com')) return false;
    if (url.includes('googleusercontent.com')) return false;
    if (url.includes('google.com/')) return false;
    if (url.includes('ggpht.com')) return false;

    // Block Wikipedia/Wikimedia FILE PAGES (not actual images)
    // File pages: /wiki/File: or /wiki/Image:
    if (url.includes('/wiki/File:')) return false;
    if (url.includes('/wiki/Image:')) return false;
    if (url.includes('wikipedia.org/wiki/')) return false;

    // Must end with an image extension (at the very end, or before query string)
    // This ensures it's actually serving an image file
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|ico)(\?.*)?$/i;
    return imageExtensions.test(url);
  }

  /**
   * Hide the preview panel with CSS
   * STRATEGY: We must keep the element "in the viewport" so Google loads the image,
   * but make it invisible to the user.
   */
  function hidePreview() {
    const style = document.createElement('style');
    style.id = 'hires-hide';
    style.textContent = `
      /* Target the main side panel container IDs and classes */
      #islsp, .islsp,
      div[jsname="CGzTgf"],
      div[role="dialog"] {
        opacity: 0 !important;
        pointer-events: none !important;
        /* Do NOT use display:none or visibility:hidden or the image won't load */
      }
      
      /* Hide the black background overlay if it appears */
      .a-modal-scrim, .scrim {
        opacity: 0 !important;
      }
    `;
    document.head.appendChild(style);
    return style;
  }

  /**
   * Remove hiding CSS
   */
  function showPreview(style) {
    if (style && style.parentNode) {
      style.parentNode.removeChild(style);
    }
  }

  /**
   * Close the preview panel
   */
  function closePreview() {
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      keyCode: 27,
      bubbles: true
    }));
  }

  /**
   * Click element to trigger Google's preview
   */
  function triggerPreview(element) {
    const clickable = element.closest('a[href]') ||
      element.closest('[jsaction*="click"]') ||
      element.closest('[data-ved]') ||
      element;

    const rect = clickable.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    // Full event sequence
    const events = [
      new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, isPrimary: true }),
      new MouseEvent('mousedown', { bubbles: true, clientX: x, clientY: y }),
      new PointerEvent('pointerup', { bubbles: true, clientX: x, clientY: y, isPrimary: true }),
      new MouseEvent('mouseup', { bubbles: true, clientX: x, clientY: y }),
      new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })
    ];

    events.forEach(e => clickable.dispatchEvent(e));
  }

  /**
   * Wait for and extract the high-res URL from preview panel
   */
  /**
   * Wait for and extract the high-res URL from preview panel
   * Uses requestAnimationFrame for checking every frame (approx 16ms)
   */
  async function waitForHighResUrl(maxWait = 5000) {
    const startTime = Date.now();

    return new Promise((resolve) => {
      const check = () => {
        if (Date.now() - startTime > maxWait) {
          log('Timeout waiting for preview');
          resolve(null);
          return;
        }

        // Method 1: Look for large images in the preview area
        const previewImages = document.querySelectorAll(
          '#islsp img, [role="dialog"] img, .islsp img, [jsname="HiaYvf"], [jsname="kn3ccd"], img.sFlh5c, img.iPVvYb, img.n3VNCb'
        );

        for (const img of previewImages) {
          const src = img.src || img.getAttribute('data-src');
          if (isDirectImageUrl(src)) {
            // Check if it's reasonably large (not another thumbnail)
            // LOWERED THRESHOLD: Any image larger than a tiny icon is likely the one we want loading
            const width = img.naturalWidth || img.width || 0;
            if (width > 150) {
              log('Found high-res image:', src.substring(0, 80));
              resolve(src);
              return;
            }
          }
        }

        // Method 2: Look for links with imgurl parameter
        const imgLinks = document.querySelectorAll('a[href*="imgurl="]');
        for (const link of imgLinks) {
          const href = link.href;
          const match = href.match(/imgurl=([^&]+)/);
          if (match) {
            try {
              const decoded = decodeURIComponent(match[1]);
              if (isDirectImageUrl(decoded)) {
                log('Found via imgurl:', decoded.substring(0, 80));
                resolve(decoded);
                return;
              }
            } catch (e) { }
          }
        }

        // Method 3: Look for "Visit" button that might have the source URL
        const visitLinks = document.querySelectorAll('a[href]:not([href*="google.com"])');
        for (const link of visitLinks) {
          const href = link.href;
          // Check if it's an image URL
          if (isDirectImageUrl(href)) {
            const rect = link.getBoundingClientRect();
            // Make sure it's visible (in the preview panel)
            if (rect.width > 0 && rect.height > 0) {
              log('Found via visible link:', href.substring(0, 80));
              resolve(href);
              return;
            }
          }
        }

        // Keep checking - SYNC WITH RENDER LOOP
        requestAnimationFrame(check);
      };

      check();
    });
  }

  /**
   * Main extraction function
   */
  async function extractHighResUrl(thumbnailElement) {
    log('Starting extraction...');

    // --- FAST PATH: Metadata Extraction ---
    // Try to find the URL directly in the link attributes before simulating any interaction.
    try {
      const parentLink = thumbnailElement.closest('a');
      if (parentLink) {
        const href = parentLink.href || '';
        const params = new URLSearchParams(href.split('?')[1]);

        // 1. Check for 'imgurl' parameter (classic Google Images structure)
        if (params.has('imgurl')) {
          const imgUrl = decodeURIComponent(params.get('imgurl'));
          if (isDirectImageUrl(imgUrl)) {
            log('FAST PATH SUCCESS: Found via imgurl param:', imgUrl);
            return imgUrl;
          }
        }

        // 2. Check for data-encoded attributes (sometimes used in newer layouts)
        // This is heuristic and might change, but worth a try (0ms cost)
        const possibleUrls = href.match(/https?:\/\/[^"'\s]+\.(jpg|png|jpeg|webp)/gi);
        if (possibleUrls) {
          for (const url of possibleUrls) {
            // Filter out thumbnails
            if (isDirectImageUrl(url) && !url.includes('encrypted-tbn')) {
              log('FAST PATH SUCCESS: Found via regex match:', url);
              return url;
            }
          }
        }
      }
    } catch (e) {
      log('Fast path check failed, proceeding to slow path', e);
    }

    // --- ROBUST PATH: Invisible Ghost Click ---
    // Fallback to triggering the preview if Fast Path failed.

    // Step 0: PRE-CLEAN
    // Ensure any existing preview is closed so we don't grab stale data
    closePreview();
    await new Promise(r => setTimeout(r, 50)); // Give Google a moment to reset

    // Hide preview with new "invisible but present" strategy
    const hideStyle = hidePreview();

    try {
      // Click to trigger preview
      log('Triggering preview...');
      triggerPreview(thumbnailElement);

      // Wait for high-res URL to appear
      const highResUrl = await waitForHighResUrl(5000);

      // Close the preview IMMEDIATELY
      closePreview();
      // REMOVED delay: await new Promise(r => setTimeout(r, 50));

      return highResUrl;

    } catch (e) {
      log('Extraction error:', e);
      return null;
    } finally {
      // Clean up CSS
      showPreview(hideStyle);

      // Safety cleanup: Ensure preview is closed even if we errored
      closePreview();
    }
  }

  // Capture right-clicks
  document.addEventListener('contextmenu', (event) => {
    lastRightClickedElement = event.target;
    log('Right-click captured:', event.target.tagName);
  }, true);

  // Handle messages from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getOriginalUrl') {
      log('Received request');

      const target = lastRightClickedElement;
      if (!target) {
        log('No target element');
        sendResponse({ originalUrl: null });
        return true;
      }

      // Run extraction
      extractHighResUrl(target).then(url => {
        if (url) {
          log('SUCCESS:', url);
          sendResponse({ originalUrl: url });
        } else {
          log('FAILED - no URL found');
          sendResponse({ originalUrl: null });
        }
      }).catch(err => {
        log('ERROR:', err);
        sendResponse({ originalUrl: null });
      });

      return true;
    }
    return false;
  });

  log('Content script loaded');
})();
