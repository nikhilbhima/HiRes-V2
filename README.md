# HiRes

A Chrome extension for power users who need high-resolution images. Extract original source images from Google Images thumbnails and upscale any image with AI.

> **Early Development Notice**: This extension is in active development. While core functionality is stable, you may encounter edge cases or minor bugs. Issues and PRs welcome.

## Features

### 1. Open with HiRes
Extract the original high-resolution source image from Google Images thumbnails with a single right-click.

### 2. Upscale with HiRes
AI-powered image upscaling (2x/4x) using Claid.ai's neural network. Works on any image across the web.

## Installation

### From Source
```bash
git clone https://github.com/your-username/hires.git
cd hires
```

1. Open Chrome → `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the cloned folder
4. Extension icon appears in toolbar

## Usage

1. Navigate to any webpage with images
2. Right-click on an image
3. Select **HiRes** from the context menu:
   - **Open with HiRes** - Opens original high-res source (Google Images)
   - **Upscale with HiRes** - Opens Upscale Studio for AI enhancement

### Upscale Studio
- Automatically starts processing at 2x scale
- Switch to 4x for maximum resolution
- Download the enhanced image when complete

## Technical Architecture

### High-Res Extraction (content.js)
Two-phase URL extraction approach:

**Phase 1: Fast Path** (0ms)
- Parses `imgurl` parameter from thumbnail's parent link
- Regex extraction of embedded image URLs

**Phase 2: Ghost Click** (fallback)
- Triggers Google's preview panel invisibly (`opacity: 0`)
- Polls with `requestAnimationFrame` for loaded high-res image
- Extracts source URL and closes preview

### Upscaling (upscale.js)
- Converts image to Blob via canvas for CORS-safe upload
- Multipart form upload to Claid.ai `/v1/image/edit/upload`
- Fallback to direct URL mode if source is publicly accessible
- Supports multiple API backends (Claid, Replicate, fal.ai, DeepAI)

## File Structure

```
hires/
├── manifest.json      # Extension config (Manifest V3)
├── background.js      # Service worker - context menu & routing
├── content.js         # URL extraction logic (injected)
├── upscale.html       # Upscale Studio UI
├── upscale.js         # Upscaling API integration
├── rules.json         # Network rules (Referer stripping)
└── icons/             # Extension icons
```

## Permissions

| Permission | Purpose |
|------------|---------|
| `contextMenus` | Right-click menu items |
| `activeTab` | Access current tab for extraction |
| `scripting` | Inject content script on demand |
| `storage` | Store user API key preferences |
| `declarativeNetRequest` | Strip Referer header for cross-origin images |

## Configuration

### API Key Setup (Required for Upscaling)
The extension uses a BYOK (Bring Your Own Key) model - you provide your own API key:

1. Sign up at [Claid.ai](https://claid.ai) (free tier available)
2. Copy your API key from the dashboard
3. In Upscale Studio, click "Configure API" when prompted
4. Enter: `claid:your_api_key`

**Supported providers:** Claid.ai (recommended), Replicate, fal.ai, DeepAI

## Supported Domains

Works on 30+ Google country domains:
- google.com, google.co.uk, google.de, google.fr, google.co.jp
- google.com.au, google.co.in, google.com.br, google.ca
- And more...

## Known Limitations

- **CORS**: Some images may fail to load due to cross-origin restrictions
- **Google DOM**: Extraction may break if Google significantly changes their image search UI
- **API Key**: Upscaling requires your own API key (free tiers available)

## Security

- XSS prevention via `escapeHtml()` for all user-facing content
- No data collection or external analytics
- API keys stored locally via `chrome.storage.sync`
- Referer headers stripped to prevent tracking

## Contributing

1. Fork the repository
2. Create a feature branch
3. Open DevTools Console and look for `[HiRes]` logs when debugging
4. Submit a PR with clear description

## License

MIT

---

Built with vanilla JS. No frameworks, no build step, no bloat.
