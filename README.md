# HiRes - Google Images High-Resolution Opener

A Chrome extension that opens the original high-resolution source image from Google Images thumbnails with a single right-click.

## Installation

1. Clone this repository or download as ZIP
2. Open Chrome and go to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select this folder
5. The extension icon should appear in your toolbar

## Usage

1. Go to Google Images and search for something
2. Right-click on any thumbnail
3. Select "Open with HiRes"
4. The original high-resolution image opens in a new tab

## How It Works

The extension uses a two-phase approach to extract the original image URL:

### Phase 1: Fast Path (Instant)
Attempts to extract the URL directly from the thumbnail's link attributes without any DOM manipulation:
- Checks for `imgurl` parameter in parent link
- Regex matches embedded image URLs in href

### Phase 2: Ghost Click (Fallback)
If Fast Path fails, triggers Google's preview panel invisibly:
1. **Pre-clean**: Close any existing preview to avoid stale data
2. **Hide Panel**: Inject CSS (`opacity: 0`) to make preview invisible but still render
3. **Simulate Click**: Full interaction sequence (pointer/mouse events)
4. **Poll for Image**: Use `requestAnimationFrame` to check every frame (~16ms)
5. **Extract URL**: Grab the high-res `src` from preview image
6. **Cleanup**: Close preview and remove CSS

### Key Technical Details

- Uses `opacity: 0` instead of `display: none` (hidden elements don't load images)
- `requestAnimationFrame` for responsive polling (syncs with browser render)
- Multiple selector fallbacks for Google's changing DOM structure
- Strips Referer header via declarativeNetRequest for cross-origin images

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration (Manifest V3) |
| `background.js` | Service worker - context menu & tab management |
| `content.js` | Injected script - URL extraction logic |
| `rules.json` | Network rules to strip Referer header |

## Permissions

- `contextMenus` - Create right-click menu item
- `activeTab` - Access current tab
- `scripting` - Inject content script
- `declarativeNetRequest` - Modify request headers

## Supported Google Domains

Works on 30+ Google country domains including:
- google.com, google.co.uk, google.de, google.fr, google.co.jp
- google.com.au, google.co.in, google.com.br, google.ca
- And many more...

## Contributing

Contributions welcome! To debug:

1. Open Google Images
2. Open DevTools (F12) → Console
3. Right-click a thumbnail → "Open with HiRes"
4. Check `[HiRes]` logs for extraction path used

## License

MIT
