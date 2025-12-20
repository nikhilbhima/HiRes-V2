# Privacy Policy for HiRes

**Last updated: December 2024**

## Overview

HiRes is a Chrome extension that helps users access high-resolution images from Google Images and upscale images using AI.

## Data Collection

**We do not collect any personal data.**

### What the extension accesses:

1. **Image URLs**: When you right-click an image and select "Open with HiRes" or "Upscale with HiRes", the extension accesses the image URL to process your request. This data is not stored or transmitted to our servers.

2. **Local Storage**: The extension uses Chrome's local storage (`chrome.storage.sync`) to save your preferences (such as custom API keys if configured). This data stays on your device and syncs only through your Chrome account.

### Third-Party Services

When using the "Upscale with HiRes" feature, your images are sent to third-party upscaling services (Claid.ai by default). Please refer to their respective privacy policies:
- Claid.ai: https://claid.ai/privacy

## Permissions Explained

| Permission | Why We Need It |
|------------|----------------|
| `contextMenus` | To add right-click menu options |
| `activeTab` | To access the current page when you invoke the extension |
| `scripting` | To extract high-resolution image URLs from Google Images |
| `storage` | To save your preferences locally |
| `declarativeNetRequest` | To remove Referer headers that block image loading |

## Data Security

- No analytics or tracking
- No data collection servers
- No user accounts required
- All processing happens locally or through the upscaling API you choose

## Changes to This Policy

We may update this privacy policy from time to time. Any changes will be reflected in this document with an updated date.

## Contact

For questions about this privacy policy, please open an issue at:
https://github.com/your-username/hires/issues
