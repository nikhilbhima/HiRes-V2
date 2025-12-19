/**
 * HiRes Upscale Studio
 * Handles image upscaling UI and API integration
 */

(function() {
  'use strict';

  // DOM Elements
  const sourcePlaceholder = document.getElementById('sourcePlaceholder');
  const sourceFrame = document.getElementById('sourceFrame');
  const sourceFooter = document.getElementById('sourceFooter');
  const sourceDimensions = document.getElementById('sourceDimensions');
  const sourceFormat = document.getElementById('sourceFormat');

  const outputPlaceholder = document.getElementById('outputPlaceholder');
  const loadingState = document.getElementById('loadingState');
  const outputFrame = document.getElementById('outputFrame');

  const processBtn = document.getElementById('processBtn');
  const downloadBtn = document.getElementById('downloadBtn');
  const configNotice = document.getElementById('configNotice');
  const configureLink = document.getElementById('configureLink');
  const scaleButtons = document.querySelectorAll('.scale-btn');

  let originalImageUrl = null;
  let upscaledImageUrl = null;
  let selectedScale = 2;

  /**
   * Get image URL from query parameter
   */
  function getImageUrlFromParams() {
    const params = new URLSearchParams(window.location.search);
    return params.get('img');
  }

  /**
   * Extract format from URL
   */
  function getImageFormat(url) {
    const match = url.match(/\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?|$)/i);
    return match ? match[1].toUpperCase() : 'Unknown';
  }

  /**
   * Load and display the source image
   */
  function loadSourceImage(url) {
    originalImageUrl = url;

    const img = document.createElement('img');
    img.src = url;
    img.alt = 'Source image';

    img.onload = function() {
      sourcePlaceholder.style.display = 'none';
      sourceFrame.innerHTML = '';
      sourceFrame.appendChild(img);
      sourceFrame.style.display = 'flex';
      sourceFooter.style.display = 'block';

      sourceDimensions.textContent = `${img.naturalWidth} × ${img.naturalHeight}`;
      sourceFormat.textContent = getImageFormat(url);

      processBtn.disabled = false;
    };

    img.onerror = function() {
      sourcePlaceholder.innerHTML = `
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <div class="error-title">Failed to load image</div>
          <div class="error-detail">${url.substring(0, 60)}...</div>
        </div>
      `;
    };
  }

  /**
   * Handle scale selection
   */
  function setupScaleSelector() {
    scaleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        scaleButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedScale = parseInt(btn.dataset.scale);
      });
    });
  }

  /**
   * Upscale image using API
   */
  async function upscaleImage(imageUrl, scale) {
    // Check for stored API configuration
    const config = await chrome.storage.sync.get(['upscaleApi', 'apiKey']);

    if (!config.apiKey) {
      // Demo mode - simulate upscaling
      return await demoUpscale(imageUrl, scale);
    }

    // API integration
    switch (config.upscaleApi) {
      case 'claid':
        return await upscaleWithClaid(imageUrl, scale, config.apiKey);
      case 'replicate':
        return await upscaleWithReplicate(imageUrl, scale, config.apiKey);
      case 'deepai':
        return await upscaleWithDeepAI(imageUrl, scale, config.apiKey);
      case 'fal':
        return await upscaleWithFal(imageUrl, scale, config.apiKey);
      default:
        return await demoUpscale(imageUrl, scale);
    }
  }

  /**
   * Demo upscaling - returns original image after delay
   */
  async function demoUpscale(imageUrl, scale) {
    await new Promise(r => setTimeout(r, 2500));
    return { url: imageUrl, isDemo: true };
  }

  /**
   * Upscale using Claid.ai API (Recommended for fidelity)
   * Best for: photos, products, faces - preserves textures without hallucinations
   */
  async function upscaleWithClaid(imageUrl, scale, apiKey) {
    const response = await fetch('https://api.claid.ai/v1-beta1/image/edit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        input: imageUrl,
        operations: {
          resizing: {
            width: `x${scale}`,
            fit: 'bounds'
          },
          upscaling: 'smart_enhance'
        },
        output: {
          format: 'png'
        }
      })
    });

    const result = await response.json();

    if (result.error) {
      const errMsg = result.error.message || '';
      // Handle common errors with user-friendly messages
      if (errMsg.includes('credit') || errMsg.includes('limit') || response.status === 402) {
        throw new Error('Out of credits! Visit claid.ai to add more.');
      }
      if (response.status === 401) {
        throw new Error('Invalid API key. Check your Claid.ai key.');
      }
      throw new Error(errMsg || 'Claid.ai upscaling failed');
    }

    return { url: result.data.output.tmp_url, isDemo: false };
  }

  /**
   * Upscale using Replicate API (Real-ESRGAN)
   */
  async function upscaleWithReplicate(imageUrl, scale, apiKey) {
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        version: 'nightmareai/real-esrgan:42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b',
        input: { image: imageUrl, scale: scale }
      })
    });

    const prediction = await response.json();

    // Poll for result
    let result = prediction;
    while (result.status !== 'succeeded' && result.status !== 'failed') {
      await new Promise(r => setTimeout(r, 1000));
      const pollResponse = await fetch(prediction.urls.get, {
        headers: { 'Authorization': `Token ${apiKey}` }
      });
      result = await pollResponse.json();
    }

    if (result.status === 'failed') {
      throw new Error(result.error || 'Upscaling failed');
    }

    return { url: result.output, isDemo: false };
  }

  /**
   * Upscale using DeepAI API
   */
  async function upscaleWithDeepAI(imageUrl, scale, apiKey) {
    const formData = new FormData();
    formData.append('image', imageUrl);

    const response = await fetch('https://api.deepai.org/api/torch-srgan', {
      method: 'POST',
      headers: { 'api-key': apiKey },
      body: formData
    });

    const result = await response.json();
    if (result.err) throw new Error(result.err);

    return { url: result.output_url, isDemo: false };
  }

  /**
   * Upscale using fal.ai API
   */
  async function upscaleWithFal(imageUrl, scale, apiKey) {
    const response = await fetch('https://fal.run/fal-ai/real-esrgan', {
      method: 'POST',
      headers: {
        'Authorization': `Key ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ image_url: imageUrl, scale: scale })
    });

    const result = await response.json();
    if (result.error) throw new Error(result.error);

    return { url: result.image.url, isDemo: false };
  }

  /**
   * Handle process button click
   */
  async function handleProcess() {
    if (!originalImageUrl) return;

    // Show loading state
    outputPlaceholder.style.display = 'none';
    outputFrame.style.display = 'none';
    loadingState.classList.add('active');
    processBtn.disabled = true;
    downloadBtn.style.display = 'none';

    try {
      const result = await upscaleImage(originalImageUrl, selectedScale);
      upscaledImageUrl = result.url;

      // Create and load upscaled image
      const img = document.createElement('img');
      img.src = result.url;
      img.alt = 'Upscaled image';

      img.onload = function() {
        loadingState.classList.remove('active');
        outputFrame.innerHTML = '';
        outputFrame.appendChild(img);
        outputFrame.style.display = 'flex';
        downloadBtn.style.display = 'flex';
        processBtn.disabled = false;

        // Update notice
        if (result.isDemo) {
          configNotice.innerHTML = `
            <strong>Demo Mode:</strong> Showing original image.
            <a class="config-link" id="configureLink2">Configure API</a> for real upscaling.
          `;
          document.getElementById('configureLink2')?.addEventListener('click', showApiConfig);
        } else {
          configNotice.style.display = 'none';
        }
      };

      img.onerror = function() {
        showError('Failed to load upscaled image');
      };

    } catch (error) {
      showError(error.message);
    }
  }

  /**
   * Show error state
   */
  function showError(message) {
    loadingState.classList.remove('active');
    outputFrame.innerHTML = `
      <div class="error-state">
        <div class="error-icon">❌</div>
        <div class="error-title">Processing Failed</div>
        <div class="error-detail">${message}</div>
      </div>
    `;
    outputFrame.style.display = 'flex';
    processBtn.disabled = false;
  }

  /**
   * Handle download
   */
  function handleDownload() {
    if (!upscaledImageUrl) return;
    window.open(upscaledImageUrl, '_blank');
  }

  /**
   * Show API configuration prompt
   */
  function showApiConfig(e) {
    e?.preventDefault();

    const input = prompt(
      'Configure Upscaling API\n\n' +
      'Supported services:\n' +
      '• Claid.ai (claid.ai) ← Recommended for fidelity\n' +
      '• Replicate (replicate.com)\n' +
      '• fal.ai (fal.ai)\n' +
      '• DeepAI (deepai.org)\n\n' +
      'Format: service:api_key\n' +
      'Example: claid:your_api_key'
    );

    if (input && input.includes(':')) {
      const [api, key] = input.split(':');
      chrome.storage.sync.set({
        upscaleApi: api.trim().toLowerCase(),
        apiKey: key.trim()
      }, () => {
        configNotice.innerHTML = `
          <strong style="color: var(--success)">API Configured!</strong>
          Using ${api.trim()} for upscaling.
        `;
      });
    }
  }

  /**
   * Initialize
   */
  function init() {
    const imageUrl = getImageUrlFromParams();

    if (!imageUrl) {
      sourcePlaceholder.innerHTML = `
        <div class="error-state">
          <div class="error-icon">🖼</div>
          <div class="error-title">No image provided</div>
          <div class="error-detail">Right-click an image on Google Images and select "Upscale with HiRes"</div>
        </div>
      `;
      return;
    }

    loadSourceImage(imageUrl);
    setupScaleSelector();

    processBtn.addEventListener('click', handleProcess);
    downloadBtn.addEventListener('click', handleDownload);
    configureLink?.addEventListener('click', showApiConfig);
  }

  init();
})();
