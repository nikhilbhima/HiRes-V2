/**
 * HiRes - Content Script
 * Extracts high-resolution image URLs from Google Images thumbnails
 * Updated December 2025 - Improved URL filtering based on Gemini's guidance
 */

(function () {
  'use strict';

  // Store the last right-clicked element and pre-observed high-res URL
  let lastRightClickedElement = null;
  let observedHighResUrl = null;

  /**
   * Extract high-res URL from attribute value (used by MutationObserver)
   * Now also captures URLs without extensions (modern CDNs often don't use them)
   */
  function extractUrlFromAttribute(attrValue) {
    if (!attrValue) return null;

    // Decode escaped characters first
    let decoded = attrValue;
    try {
      decoded = attrValue
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\\//g, '/')
        .replace(/\\"/g, '"');
    } catch (e) {}

    // Pattern 1: URLs with image extensions
    const extPattern = /https?:\/\/[^"\[\]\s,\\<>]+\.(?:jpg|jpeg|png|webp|svg|bmp|gif|tiff?)(?:\?[^"\[\]\s,\\<>]*)?/gi;

    // Pattern 2: URLs in array format ["url", width, height] - these are often the high-res ones
    const arrayPattern = /\["(https?:\/\/[^"]+)",\s*(\d+),\s*(\d+)\]/g;

    const allUrls = [];

    // Collect URLs with extensions
    const extMatches = decoded.match(extPattern) || [];
    allUrls.push(...extMatches);

    // Collect URLs from array format (with dimensions for sorting)
    let match;
    while ((match = arrayPattern.exec(decoded)) !== null) {
      const url = match[1];
      const width = parseInt(match[2]);
      const height = parseInt(match[3]);
      // Only add if it looks like a real image (reasonable dimensions)
      if (width > 100 && height > 100) {
        allUrls.push({ url, pixels: width * height });
      }
    }

    // Log what we found for debugging
    console.log('HiRes: Raw extraction found', allUrls.length, 'URLs');

    // Filter out Google thumbnails
    const candidates = allUrls
      .map(item => typeof item === 'string' ? { url: item, pixels: 0 } : item)
      .filter(item => {
        const lowerUrl = item.url.toLowerCase();
        const isGoogle = lowerUrl.includes('gstatic.com') ||
                         lowerUrl.includes('googleusercontent.com') ||
                         lowerUrl.includes('encrypted-tbn') ||
                         lowerUrl.includes('ggpht.com') ||
                         lowerUrl.includes('googleapis.com') ||
                         lowerUrl.startsWith('data:');
        return !isGoogle;
      });

    console.log('HiRes: After filtering:', candidates.length, 'non-Google URLs');

    if (candidates.length === 0) return null;

    // Sort: first by pixel count (if available), then by URL length
    candidates.sort((a, b) => {
      if (a.pixels !== b.pixels) return b.pixels - a.pixels;
      return b.url.length - a.url.length;
    });

    // Log top candidates
    console.log('HiRes: Top candidates:');
    candidates.slice(0, 3).forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.pixels}px, ${c.url.length}chars] ${c.url.substring(0, 60)}...`);
    });

    return candidates[0].url;
  }

  /**
   * Check existing attributes for high-res URL (before waiting for changes)
   */
  function checkExistingAttributes(container) {
    const attrsToCheck = ['data-i', 'data-ow', 'data-it'];
    for (const attr of attrsToCheck) {
      if (container.hasAttribute(attr)) {
        const value = container.getAttribute(attr);
        // Don't reject based on containing gstatic - the attribute often has BOTH
        // gstatic URLs and the real URL. Let extractUrlFromAttribute filter them.
        if (value && value.includes('http')) {
          console.log('HiRes: Checking attribute', attr, '(length:', value.length + ')');
          const url = extractUrlFromAttribute(value);
          if (url) {
            console.log('HiRes: Found high-res URL in', attr);
            return url;
          }
        }
      }
    }
    return null;
  }

  /**
   * Capture the element when user right-clicks
   * SECRET WEAPON: Use MutationObserver to wait for Google to populate high-res URL
   */
  document.addEventListener('contextmenu', async (event) => {
    const target = event.target;
    console.log('HiRes: Captured right-click on:', target.tagName);

    // Reset observed URL
    observedHighResUrl = null;

    // Find the thumbnail container that Google attaches metadata to
    const thumbnail = target.closest('div[data-it], div[data-ow], div[data-i], [jsname], a[href*="/imgres"]');
    if (!thumbnail) {
      console.log('HiRes: No thumbnail container found');
      lastRightClickedElement = target;
      return;
    }

    // Find the actual thumbnail image
    const thumbnailImg = target.tagName === 'IMG' ? target : thumbnail.querySelector('img') || target;

    // STEP 1: Check if high-res URL already exists in attributes
    const existingUrl = checkExistingAttributes(thumbnail);
    if (existingUrl) {
      console.log('HiRes: ✅ High-res URL already available:', existingUrl);
      observedHighResUrl = existingUrl;
      lastRightClickedElement = target;
      return;
    }

    // STEP 2: Set up MutationObserver BEFORE triggering events
    let observerResolved = false;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const attrName = mutation.attributeName;
          const attrValue = mutation.target.getAttribute(attrName);

          // Check relevant attributes - don't filter by gstatic here, let extractUrlFromAttribute handle it
          if ((attrName === 'data-i' || attrName === 'data-ow' || attrName === 'data-it') &&
              attrValue && attrValue.includes('http')) {

            console.log('HiRes: Observer detected change in', attrName);
            const url = extractUrlFromAttribute(attrValue);
            if (url) {
              console.log('HiRes: ✅ Observer caught high-res URL:', url);
              observedHighResUrl = url;
              observerResolved = true;
              observer.disconnect();
              return;
            }
          }
        }
      }
    });

    // Start watching the thumbnail and its subtree for attribute changes
    observer.observe(thumbnail, {
      attributes: true,
      subtree: true,
      attributeFilter: ['data-i', 'data-ow', 'data-it', 'data-lpage', 'data-ou']
    });

    // Also observe parent elements
    let parent = thumbnail.parentElement;
    for (let i = 0; i < 5 && parent; i++) {
      observer.observe(parent, { attributes: true, subtree: true });
      parent = parent.parentElement;
    }

    // STEP 3: Trigger Google's "Wake Up" events
    const rect = thumbnailImg.getBoundingClientRect();
    const eventProps = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1
    };

    // Fire pointerdown first (modern browsers expect this order)
    thumbnail.dispatchEvent(new PointerEvent('pointerdown', { ...eventProps, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    thumbnail.dispatchEvent(new MouseEvent('mousedown', eventProps));

    // Also on the image itself
    thumbnailImg.dispatchEvent(new PointerEvent('pointerdown', { ...eventProps, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    thumbnailImg.dispatchEvent(new MouseEvent('mousedown', eventProps));

    // STEP 4: Wait for observer or timeout (1 second for slow connections)
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (observerResolved) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 50);

      setTimeout(() => {
        clearInterval(checkInterval);
        if (!observerResolved) {
          console.log('HiRes: Observer timeout - checking attributes one more time');
          // Final check before giving up
          const finalUrl = checkExistingAttributes(thumbnail);
          if (finalUrl) {
            observedHighResUrl = finalUrl;
            console.log('HiRes: ✅ Found URL on final check:', finalUrl);
          }
        }
        observer.disconnect();
        resolve();
      }, 1000);
    });

    // Complete the interaction cycle
    thumbnail.dispatchEvent(new PointerEvent('pointerup', { ...eventProps, pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    thumbnail.dispatchEvent(new MouseEvent('mouseup', eventProps));

    // Store the element
    lastRightClickedElement = target;

    if (observedHighResUrl) {
      console.log('HiRes: Metadata activation complete - URL pre-captured:', observedHighResUrl);
    } else {
      console.log('HiRes: Metadata activation complete - will extract on demand');
    }
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
      console.log('HiRes: Last right-clicked element:', lastRightClickedElement?.tagName);

      // PRIORITY 1: Use the pre-observed URL from MutationObserver (most reliable!)
      if (observedHighResUrl) {
        console.log('HiRes: Using pre-observed URL from MutationObserver:', observedHighResUrl);
        const finalUrl = stripSizingParameters(observedHighResUrl);
        sendResponse({ originalUrl: finalUrl });
        // Clear for next use
        observedHighResUrl = null;
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
