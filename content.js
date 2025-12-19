/**
 * HiRes - Content Script
 * Extracts high-resolution image URLs from Google Images thumbnails
 * Updated December 2025 - MutationObserver approach (no race conditions)
 */

(function () {
  'use strict';

  // Store the captured high-res URL and last element
  let capturedHighResUrl = null;
  let lastRightClickedElement = null;

  /**
   * Get best URL from metadata string - THE SECRET SAUCE
   * Finds all URLs, filters out Google thumbnails, picks the longest one
   */
  function getBestUrl(metadataString) {
    if (!metadataString) return null;

    // Decode escaped characters
    let decoded = metadataString;
    try {
      decoded = metadataString
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"');
    } catch (e) {}

    // Find all potential image URLs
    const urlPattern = /https?:\/\/[^"\[\]\s,\\<>]+\.(?:jpg|jpeg|png|webp|svg|gif|bmp)/gi;
    const allUrls = decoded.match(urlPattern) || [];

    console.log('HiRes: Found', allUrls.length, 'total URLs in metadata');

    // Filter out Google's thumbnail servers
    const candidates = allUrls.filter(url => {
      const low = url.toLowerCase();
      return !low.includes('gstatic.com') &&
             !low.includes('googleusercontent.com') &&
             !low.includes('encrypted-tbn') &&
             !low.includes('ggpht.com') &&
             !low.includes('googleapis.com');
    });

    console.log('HiRes: After filtering:', candidates.length, 'external URLs');

    if (candidates.length === 0) return null;

    // SECRET: The longest URL is almost always the original source
    candidates.sort((a, b) => b.length - a.length);

    // Log top candidates
    console.log('HiRes: Top candidates by length:');
    candidates.slice(0, 3).forEach((url, i) => {
      console.log(`  ${i + 1}. [${url.length} chars] ${url.substring(0, 70)}...`);
    });

    try {
      return decodeURIComponent(candidates[0]);
    } catch (e) {
      return candidates[0];
    }
  }

  /**
   * Right-click handler - sets up MutationObserver and triggers lazy-load
   * KEY: Does NOT wait/block - observer captures URL asynchronously
   */
  document.addEventListener('contextmenu', (event) => {
    const target = event.target;
    console.log('HiRes: Right-click captured on:', target.tagName);

    // Reset captured URL
    capturedHighResUrl = null;
    lastRightClickedElement = target;

    // Find the thumbnail container
    const container = target.closest('div[data-it], div[data-ow], div[data-i], [jsname], a[href*="/imgres"]');
    if (!container) {
      console.log('HiRes: No thumbnail container found');
      return;
    }

    // STEP 1: Check if URL already exists in attributes
    const attrs = ['data-i', 'data-ow', 'data-it'];
    for (const attr of attrs) {
      if (container.hasAttribute(attr)) {
        const val = container.getAttribute(attr);
        if (val && val.includes('http') && !val.includes('base64')) {
          const url = getBestUrl(val);
          if (url) {
            capturedHighResUrl = url;
            console.log('HiRes: ✅ URL already available:', url);
            return;
          }
        }
      }
    }

    // STEP 2: Set up MutationObserver to watch for lazy-loaded data
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'data-i' || mutation.attributeName === 'data-ow') {
          const val = mutation.target.getAttribute(mutation.attributeName);

          // Only act if the data contains a real external link (not base64/gstatic)
          if (val && val.includes('http') && !val.includes('gstatic.com') && !val.includes('base64')) {
            const highRes = getBestUrl(val);
            if (highRes) {
              capturedHighResUrl = highRes;
              console.log('HiRes: ✅ Observer captured URL:', highRes);
              observer.disconnect();
              return;
            }
          }
        }
      }
    });

    // Start observing the container
    observer.observe(container, { attributes: true, subtree: true });

    // Also observe parent elements (Google sometimes updates parents)
    let parent = container.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      observer.observe(parent, { attributes: true, subtree: true });
      parent = parent.parentElement;
    }

    // STEP 3: Trigger Google's "Wake Up" events to force lazy-load
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: event.clientX,
      clientY: event.clientY
    };

    container.dispatchEvent(new PointerEvent('pointerdown', { ...opts, isPrimary: true }));
    container.dispatchEvent(new MouseEvent('mousedown', opts));

    // STEP 4: Safety timeout - disconnect after 1.5 seconds
    setTimeout(() => {
      observer.disconnect();
      // Final check if we still don't have a URL
      if (!capturedHighResUrl) {
        for (const attr of attrs) {
          if (container.hasAttribute(attr)) {
            const val = container.getAttribute(attr);
            if (val && val.includes('http')) {
              const url = getBestUrl(val);
              if (url) {
                capturedHighResUrl = url;
                console.log('HiRes: ✅ URL found on final check:', url);
                break;
              }
            }
          }
        }
      }
    }, 1500);
  }, true);

  /**
   * Decode Google's various escape sequences
   */
  function decodeGoogleString(str) {
    if (!str) return str;

    try {
      let decoded = str
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"')
        .replace(/\\'/g, "'")
        .replace(/\\n/g, '')
        .replace(/\\t/g, '');

      return decoded;
    } catch (e) {
      return str;
    }
  }

  /**
   * Strip Google's sizing parameters from URL to get original full resolution
   * Removes patterns like =w200-h150, =s1024, =w1920, etc.
   */
  function stripSizingParameters(url) {
    if (!url) return url;

    // Remove sizing params at the end: =w200-h150, =s1024, =w1920-h1080-k-no, etc.
    let cleaned = url.replace(/=w\d+(-h\d+)?(-[a-z-]+)?$/i, '');
    cleaned = cleaned.replace(/=s\d+(-[a-z-]+)?$/i, '');
    cleaned = cleaned.replace(/=h\d+(-[a-z-]+)?$/i, '');

    // Also handle mid-URL sizing params (less common)
    cleaned = cleaned.replace(/\/w\d+-h\d+\//, '/');
    cleaned = cleaned.replace(/\/s\d+\//, '/');

    return cleaned;
  }

  /**
   * Check if URL is a Google thumbnail (should be excluded)
   */
  function isGoogleThumbnail(url) {
    if (!url) return true;
    const lowerUrl = url.toLowerCase();

    // These are ALWAYS thumbnails - never the original
    return lowerUrl.includes('encrypted-tbn') ||
           lowerUrl.includes('gstatic.com') ||
           lowerUrl.includes('googleusercontent.com') ||
           lowerUrl.includes('ggpht.com') ||
           lowerUrl.includes('google.com/images') ||
           lowerUrl.includes('googleapis.com');
  }

  /**
   * Check if URL looks like a valid original image
   */
  function isValidOriginalUrl(url) {
    if (!url) return false;
    if (!url.startsWith('http')) return false;
    if (isGoogleThumbnail(url)) return false;

    // Should have a reasonable length
    if (url.length < 20) return false;

    return true;
  }

  /**
   * Extract URL from imgurl parameter
   */
  function extractFromImgurl(href) {
    if (!href || !href.includes('imgurl=')) return null;

    try {
      const url = new URL(href);
      const imgurl = url.searchParams.get('imgurl');
      if (imgurl) {
        return decodeURIComponent(imgurl);
      }
    } catch (e) {
      const match = href.match(/imgurl=([^&]+)/);
      if (match) {
        try {
          return decodeURIComponent(match[1]);
        } catch (e2) {
          return match[1];
        }
      }
    }
    return null;
  }

  /**
   * Extract ALL URLs from metadata and filter to get original sources only
   * Returns array of valid original URLs (non-thumbnail)
   */
  function extractOriginalUrls(metadataString) {
    if (!metadataString) return [];

    const decoded = decodeGoogleString(metadataString);
    const allUrls = [];

    // Pattern 1: URLs with image extensions
    const imageUrlRegex = /(https?:\/\/[^"\[\]\s,\\]+\.(?:jpg|jpeg|png|webp|gif|bmp|svg|tiff?)(?:\?[^"\[\]\s,\\]*)?)/gi;
    let matches = decoded.match(imageUrlRegex);
    if (matches) {
      allUrls.push(...matches);
    }

    // Pattern 2: URLs in quotes
    const quotedUrlRegex = /"(https?:\/\/[^"\\]+)"/g;
    let match;
    while ((match = quotedUrlRegex.exec(decoded)) !== null) {
      allUrls.push(match[1]);
    }

    // Pattern 3: URLs in array format [url, width, height]
    const arrayUrlRegex = /\["(https?:\/\/[^"]+)",\s*(\d+),\s*(\d+)\]/g;
    while ((match = arrayUrlRegex.exec(decoded)) !== null) {
      // Include dimensions for sorting
      allUrls.push({ url: match[1], width: parseInt(match[2]), height: parseInt(match[3]) });
    }

    // Filter: Remove ALL Google thumbnails
    const originalUrls = allUrls
      .map(item => typeof item === 'string' ? { url: item, width: 0, height: 0 } : item)
      .filter(item => isValidOriginalUrl(item.url))
      .map(item => ({
        ...item,
        url: decodeGoogleString(item.url)
      }));

    // Sort by resolution (highest first) if we have dimension info
    originalUrls.sort((a, b) => (b.width * b.height) - (a.width * a.height));

    console.log('HiRes: Found', originalUrls.length, 'original URLs from metadata');

    return originalUrls.map(item => item.url);
  }

  /**
   * Get high-res URL from the preview panel (side panel)
   */
  function getUrlFromPreviewPanel() {
    // Look for the large preview image in the side panel
    const previewSelectors = [
      'img[jsname="kn3ccd"]',      // Common preview image jsname
      'img[jsname="HiaYvf"]',      // Alternative preview jsname
      'img.sFlh5c',                // Preview image class
      'img.n3VNCb',                // Another preview class
      '[data-noaft] img',          // Container for preview
      'a[jsname="sTFXNd"] img',    // Link containing preview
      'img[data-iml]',             // Images with data-iml attribute
    ];

    for (const selector of previewSelectors) {
      const previewImg = document.querySelector(selector);
      if (previewImg) {
        const src = previewImg.src || previewImg.dataset.src;
        if (src && isValidOriginalUrl(src)) {
          console.log('HiRes: Found URL in preview panel:', src);
          return src;
        }
      }
    }

    // Check for original URL in preview panel links
    const previewLinks = document.querySelectorAll('a[href*="imgurl="]');
    for (const link of previewLinks) {
      const imgurl = extractFromImgurl(link.href);
      if (imgurl && isValidOriginalUrl(imgurl)) {
        console.log('HiRes: Found URL in preview link:', imgurl);
        return imgurl;
      }
    }

    return null;
  }

  /**
   * Simulate mouseover to trigger Google's lazy-loading of high-res URLs
   */
  async function simulateHoverAndExtract(targetElement) {
    return new Promise((resolve) => {
      console.log('HiRes: Simulating hover to load metadata');

      // Find the hoverable container
      const hoverTarget = targetElement.closest('a') ||
                          targetElement.closest('[jsaction]') ||
                          targetElement.closest('[data-ved]') ||
                          targetElement;

      // Create and dispatch mouse events
      const mouseEnter = new MouseEvent('mouseenter', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      const mouseOver = new MouseEvent('mouseover', {
        bubbles: true,
        cancelable: true,
        view: window
      });

      hoverTarget.dispatchEvent(mouseEnter);
      hoverTarget.dispatchEvent(mouseOver);

      // Wait for Google to load the metadata (100-200ms)
      setTimeout(() => {
        // Try extraction again after hover
        const metadataAttributes = ['data-it', 'data-ow', 'data-is', 'data-i', 'data-lpage', 'data-ou'];

        let element = targetElement;
        for (let i = 0; i < 15 && element; i++) {
          for (const attr of metadataAttributes) {
            if (element.hasAttribute && element.hasAttribute(attr)) {
              const value = element.getAttribute(attr);
              const urls = extractOriginalUrls(value);
              if (urls.length > 0) {
                console.log('HiRes: Found URL after hover simulation:', urls[0]);
                resolve(urls[0]);
                return;
              }
            }
          }
          element = element.parentElement;
        }

        // Still nothing? Try mouse leave and resolve null
        const mouseLeave = new MouseEvent('mouseleave', { bubbles: true });
        hoverTarget.dispatchEvent(mouseLeave);
        resolve(null);
      }, 150);
    });
  }

  /**
   * Programmatically click thumbnail to load preview, then extract URL
   */
  async function clickAndExtract(targetElement) {
    return new Promise((resolve) => {
      console.log('HiRes: Attempting click-to-load strategy');

      // Find clickable element
      const clickable = targetElement.closest('a') || targetElement;

      // Simulate click
      clickable.click();

      // Wait for preview to load
      setTimeout(() => {
        const url = getUrlFromPreviewPanel();

        // Try to close the panel by pressing Escape
        const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        document.dispatchEvent(escapeEvent);

        resolve(url);
      }, 300);
    });
  }

  /**
   * THE SECRET SAUCE: Extract true high-res URL from data attributes
   * This is the key function - ignores img src and looks at metadata only
   * FINAL BOSS LOGIC: Sort by URL length - longest URL is almost always the original source
   */
  function extractTrueHighRes(targetElement) {
    console.log('HiRes: Using extractTrueHighRes function');

    // 1. Find the metadata container - CRITICAL: look for data-i or data-ow
    const container = targetElement.closest('div[data-i], div[data-ow], [data-it], a[href*="/imgres"]');

    if (!container) {
      console.log('HiRes: No metadata container found');
      return null;
    }

    console.log('HiRes: Found container:', container.tagName);

    // 2. Get the raw metadata string - prioritize data-i and data-ow
    const rawData = container.getAttribute('data-i') ||
                    container.getAttribute('data-ow') ||
                    container.getAttribute('data-it');

    if (rawData) {
      console.log('HiRes: Found raw metadata (length:', rawData.length + ')');

      // Decode any escaped characters first
      const decoded = decodeGoogleString(rawData);

      // 3. The Secret Regex: Find ALL HTTP URLs with image extensions
      const urlPattern = /https?:\/\/[^"\[\]\s,\\]+\.(?:jpg|jpeg|png|webp|svg|bmp|gif|tiff?)/gi;
      const allUrls = decoded.match(urlPattern) || [];

      console.log('HiRes: Found', allUrls.length, 'total URLs in metadata');

      // 4. CRITICAL FILTER: Remove ALL Google-hosted thumbnails
      const candidates = allUrls.filter(url => {
        const lowerUrl = url.toLowerCase();
        return !lowerUrl.includes('gstatic.com') &&
               !lowerUrl.includes('googleusercontent.com') &&
               !lowerUrl.includes('google.com') &&
               !lowerUrl.includes('encrypted-tbn') &&
               !lowerUrl.includes('ggpht.com') &&
               !lowerUrl.includes('googleapis.com');
      });

      console.log('HiRes: Found', candidates.length, 'non-Google candidate URLs');

      if (candidates.length > 0) {
        // 5. THE SECRET: Sort by URL length (longest first)
        // High-res source URLs from original sites are almost ALWAYS longer
        // than compressed Google versions or path-based thumbnails
        // e.g., "https://site.com/wp-content/uploads/2025/12/original-full-res.jpg" (LONG)
        //   vs  "https://site.com/thumbs/img.jpg" (SHORT)
        candidates.sort((a, b) => b.length - a.length);

        // Log candidates for debugging
        console.log('HiRes: Top 3 candidates by length:');
        candidates.slice(0, 3).forEach((url, i) => {
          console.log(`  ${i + 1}. [${url.length} chars] ${url.substring(0, 80)}...`);
        });

        // 6. Return the longest URL (most likely the original source)
        const bestUrl = candidates[0];
        try {
          // Strip any trailing Google sizing params like =w...-h...
          const cleaned = bestUrl.replace(/=w\d+(-h\d+)?(-[a-z-]+)?$/i, '')
                                 .replace(/=s\d+(-[a-z-]+)?$/i, '');
          return decodeURIComponent(cleaned);
        } catch (e) {
          return bestUrl;
        }
      }
    }

    // 5. Fallback: Check for imgurl in parent anchor's href
    const anchor = targetElement.closest('a[href*="imgurl="]') ||
                   container.closest('a[href*="imgurl="]');

    if (anchor && anchor.href) {
      const imgurl = extractFromImgurl(anchor.href);
      if (imgurl && isValidOriginalUrl(imgurl)) {
        console.log('HiRes: Found URL in imgurl fallback:', imgurl);
        return imgurl;
      }
    }

    // 6. Try /imgres anchor
    const imgresAnchor = targetElement.closest('a[href*="/imgres"]');
    if (imgresAnchor) {
      const imgurl = extractFromImgurl(imgresAnchor.href);
      if (imgurl && isValidOriginalUrl(imgurl)) {
        console.log('HiRes: Found URL in imgres anchor:', imgurl);
        return imgurl;
      }
    }

    return null;
  }

  /**
   * Main function: Get high-res URL using multiple strategies
   */
  async function getHighResUrl(targetElement, useClickFallback = true) {
    if (!targetElement) {
      console.log('HiRes: No target element');
      return null;
    }

    console.log('HiRes: Searching for high-res URL');

    // STRATEGY 1: Use the "Secret Sauce" extraction (MOST RELIABLE)
    const trueHighRes = extractTrueHighRes(targetElement);
    if (trueHighRes) {
      console.log('HiRes: Found via extractTrueHighRes:', trueHighRes);
      return trueHighRes;
    }

    // Strategy 2: Check parent containers for metadata attributes (fallback)
    const metadataAttributes = ['data-it', 'data-ow', 'data-is', 'data-i', 'data-lpage', 'data-ou', 'data-tbnid'];

    let element = targetElement;
    for (let i = 0; i < 15 && element; i++) {
      // Check each metadata attribute
      for (const attr of metadataAttributes) {
        if (element.hasAttribute && element.hasAttribute(attr)) {
          const value = element.getAttribute(attr);
          console.log('HiRes: Checking attribute', attr, '(length:', value.length + ')');

          const urls = extractOriginalUrls(value);
          if (urls.length > 0) {
            console.log('HiRes: Found URL in', attr + ':', urls[0]);
            return urls[0];
          }
        }
      }

      // Check for imgurl in anchor href
      if (element.tagName === 'A' && element.href) {
        const imgurl = extractFromImgurl(element.href);
        if (imgurl && isValidOriginalUrl(imgurl)) {
          console.log('HiRes: Found URL in href imgurl:', imgurl);
          return imgurl;
        }
      }

      element = element.parentElement;
    }

    // Strategy 2: Find nearest /imgres anchor
    const imgresAnchor = targetElement.closest('a[href*="/imgres"]');
    if (imgresAnchor) {
      const imgurl = extractFromImgurl(imgresAnchor.href);
      if (imgurl && isValidOriginalUrl(imgurl)) {
        console.log('HiRes: Found URL in imgres anchor:', imgurl);
        return imgurl;
      }
    }

    // Strategy 3: Search siblings and nearby elements
    const searchRoot = targetElement.closest('[data-ved]') ||
                       targetElement.closest('[jscontroller]') ||
                       targetElement.parentElement?.parentElement?.parentElement;

    if (searchRoot) {
      const elementsWithData = searchRoot.querySelectorAll('[data-it], [data-ow], [data-ou], [data-lpage], [data-i]');
      for (const el of elementsWithData) {
        for (const attr of metadataAttributes) {
          if (el.hasAttribute(attr)) {
            const value = el.getAttribute(attr);
            const urls = extractOriginalUrls(value);
            if (urls.length > 0) {
              console.log('HiRes: Found URL in nearby element:', urls[0]);
              return urls[0];
            }
          }
        }
      }
    }

    // Strategy 4: Check if preview panel is already open
    const previewUrl = getUrlFromPreviewPanel();
    if (previewUrl) {
      return previewUrl;
    }

    // Strategy 5: Parse script tags for thumbnail ID match
    const thumbnailSrc = targetElement.src || '';
    const thumbnailId = thumbnailSrc.match(/tbn:([A-Za-z0-9_-]+)/)?.[1];

    if (thumbnailId) {
      console.log('HiRes: Searching scripts for thumbnail ID:', thumbnailId);
      const scriptTags = document.querySelectorAll('script:not([src])');

      for (const script of scriptTags) {
        const content = script.textContent || '';
        if (content.includes(thumbnailId)) {
          const urls = extractOriginalUrls(content);
          if (urls.length > 0) {
            console.log('HiRes: Found URL in script:', urls[0]);
            return urls[0];
          }
        }
      }
    }

    // Strategy 6: Hover simulation (Google loads URLs on hover)
    console.log('HiRes: Trying hover simulation');
    const hoverUrl = await simulateHoverAndExtract(targetElement);
    if (hoverUrl) {
      return hoverUrl;
    }

    // Strategy 7: Click-to-load fallback (last resort)
    if (useClickFallback) {
      console.log('HiRes: Trying click-to-load fallback');
      const clickUrl = await clickAndExtract(targetElement);
      if (clickUrl) {
        return clickUrl;
      }
    }

    console.log('HiRes: Could not find high-res URL');
    return null;
  }

  /**
   * Handle messages from background script
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'getOriginalUrl') {
      console.log('HiRes: Received request for original URL');
      console.log('HiRes: Captured URL:', capturedHighResUrl);

      // PRIORITY 1: Use the captured URL from MutationObserver (most reliable!)
      if (capturedHighResUrl) {
        console.log('HiRes: ✅ Using captured high-res URL:', capturedHighResUrl);
        const finalUrl = stripSizingParameters(capturedHighResUrl);
        sendResponse({ originalUrl: finalUrl });
        // Clear for next use
        capturedHighResUrl = null;
        return true;
      }

      // Use the captured element from contextmenu event
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

      // Use async/await pattern with sendResponse
      (async () => {
        let originalUrl = await getHighResUrl(targetElement);

        if (originalUrl) {
          // Strip any sizing parameters to get true original resolution
          originalUrl = stripSizingParameters(originalUrl);
          console.log('HiRes: SUCCESS - Sending original URL:', originalUrl);
          sendResponse({ originalUrl: originalUrl });
        } else {
          console.log('HiRes: FAILED - No original URL found');
          sendResponse({ originalUrl: null });
        }
      })();

      return true; // Keep message channel open for async response
    }

    return false;
  });

  console.log('HiRes: Content script loaded (December 2025 - Enhanced version)');
})();
