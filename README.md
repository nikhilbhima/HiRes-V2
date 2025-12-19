# HiRes - Google Images High-Resolution Opener

A Chrome extension that attempts to open the original high-resolution source image from Google Images thumbnails.

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
4. The original high-resolution image should open in a new tab

## Current Approach: "Ghost Click"

Since Google lazy-loads image metadata, we use a "Ghost Click" strategy:

1. **Hide Preview Panel**: Inject CSS to make Google's preview panel invisible
2. **Simulate Click**: Trigger a full interaction sequence (pointerdown → mousedown → pointerup → mouseup → click)
3. **Wait for High-Res**: Poll the DOM every 50ms looking for the large preview image
4. **Extract URL**: Once found, grab the `src` from the preview image
5. **Cleanup**: Close the preview panel and remove hiding CSS
6. **Open Image**: Open the high-res URL in a new tab

### Why This Approach?

- Google only loads the full-resolution URL when you interact with a thumbnail
- The preview panel's large image is the "source of truth" - same as "Open image in new tab"
- We let Google do the work, then grab the result

## Known Issues / Work in Progress

### Still Getting Base64/Low-Res Images

The extension sometimes still returns the base64 thumbnail instead of the high-res source. Possible causes:

1. **Selector Mismatch**: Google frequently changes their DOM structure and class names. The selectors we use (`img[jsname="cpNoic"]`, `img.n3VNCb`, etc.) may be outdated.

2. **Timing Issues**: The preview panel may not have loaded the high-res image yet when we check, even with 2.5 second timeout.

3. **Event Handling**: Google's JavaScript may not be recognizing our simulated click events as "real" user interactions.

4. **CSS Hiding Interference**: The CSS we inject to hide the preview panel might be preventing Google from loading the high-res image.

### Potential Fixes to Try

- [ ] Remove the hiding CSS and accept the brief visual flash
- [ ] Use MutationObserver instead of setInterval
- [ ] Increase timeout to 5+ seconds
- [ ] Try different event dispatch methods
- [ ] Inspect current Google Images DOM to find updated selectors
- [ ] Use Chrome DevTools to manually identify the correct preview image element

## Technical Details

### Files

- `manifest.json` - Extension configuration (Manifest V3)
- `background.js` - Service worker that creates context menu and handles tab opening
- `content.js` - Injected into Google Images pages, handles extraction
- `rules.json` - Declarative net request rules to strip Referer header

### Permissions

- `contextMenus` - Create right-click menu item
- `activeTab` - Access current tab
- `scripting` - Inject content script
- `declarativeNetRequest` - Modify request headers (strip Referer)

## Contributing

If you can identify the correct selectors for Google's current (December 2025) preview panel image, please open an issue or PR!

To debug:
1. Open Google Images
2. Open DevTools (F12)
3. Click a thumbnail manually
4. Inspect the large preview image element
5. Note its `jsname`, `class`, or other identifying attributes

## License

MIT
