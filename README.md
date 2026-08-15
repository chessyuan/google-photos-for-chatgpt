# Google Photos for ChatGPT

Google Photos for ChatGPT is a local-first Chrome Extension that lets you select cloud photos with the official Google Photos Picker and attach them directly to a ChatGPT conversation.

```text
ChatGPT → Google Photos Picker → select photos → Done
        → photos appear in the ChatGPT attachment area
```

No Windows file chooser is opened, no photo is intentionally saved to Downloads, and no companion server is required.

> This project is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google or OpenAI.

[简体中文](README.zh-CN.md) · [Privacy Policy](PRIVACY.md) · [隐私政策](PRIVACY.zh-CN.md)

## v1.1.0 release status

The v1.1.0 code implements one-click Google authorization, but the maintainer's Google Cloud OAuth publishing and verification status cannot be verified from this repository. **v1.1.0 must not be presented as publicly available to every Google Account until the owner completes and documents the Google Cloud checks in [the verification checklist](docs/GOOGLE_OAUTH_VERIFICATION.md).**

The latest published release remains v1.0.0 while this gate is unresolved.

## Quick start

1. Download the latest release.
2. Extract it.
3. Load the extension in Google Chrome.
4. Open ChatGPT.
5. Click the Google Photos icon.
6. Sign in to and authorize your Google account the first time.
7. Pick photos and press **Done**.

After authorization, later clicks silently reuse Chrome's cached Google authorization and open an already-prepared Picker whenever possible.

## Features

- One-click Google Photos connection through the official `chrome.identity` API.
- No token, Client ID, Google Cloud, npm, or development setup for normal release users.
- Official Google Photos Picker with single- and multi-select.
- Only `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` for Google Photos access.
- English and Simplified Chinese extension UI through Chrome `_locales`.
- Connected, reconnect, and disconnect controls in the popup and options page.
- Product-facing authorization errors without exposing raw OAuth errors or tokens.
- In-memory image processing; no intentional writes to Downloads.
- Standby Picker sessions, atomic session consumption, expiration handling, MV3 alarms, and page preload.
- Fast authorized-user path with silent auth and no repeated interactive consent.
- SPA redraw recovery and resilient ChatGPT file-input / drag-and-drop attachment strategies.
- Manifest V3 support in Google Chrome. Microsoft Edge can load the extension UI and ChatGPT integration, but Edge does not implement `chrome.identity.getAuthToken`; Google authorization therefore requires a future Edge-specific `launchWebAuthFlow` build and a compatible OAuth client.

## Install the release ZIP

1. Download the ZIP from [GitHub Releases](https://github.com/chessyuan/google-photos-for-chatgpt/releases).
2. Extract it to a permanent folder.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Choose **Load unpacked**.
6. Select the extracted folder whose root contains `manifest.json`.
7. Reload any already-open `https://chatgpt.com/` tab.

The unpacked extension ID is fixed as `igacbcmbkglkglkindhcpmagafnboolj`.

Microsoft's current extension API documentation states that Edge does not support `identity.getAuthToken`. The extension shows an actionable browser-compatibility message instead of a raw OAuth error in Edge. Do not expect the Chrome OAuth client in this build to authorize on Edge.

## Connect and use Google Photos

The extension never asks for a Google password. On the first user-initiated click:

```text
Click Google Photos
→ Chrome/Google OAuth authorization
→ Picker session is created automatically
→ Google Photos Picker opens
→ select photos and press Done
→ selected photos are attached to ChatGPT
```

No second click is required after authorization. On later clicks, the extension first requests authorization silently. If the cached grant is still valid, no Google prompt appears.

The popup and options page show:

- **Connected** when Chrome can silently obtain a valid token.
- **Connect Google Photos** when user interaction is required.
- **Reconnect** to restart the official authorization flow.
- **Disconnect Google Photos** to clear the extension's Chrome Identity state and suppress background prewarming until the user connects again.

Disconnect does not send a revoke request to a custom server and does not affect unrelated applications. The extension has no token backend.

## How it works

```text
chrome.identity OAuth
→ POST https://photospicker.googleapis.com/v1/sessions
→ open pickerUri/autoclose
→ poll using Google's pollingConfig
→ GET /v1/mediaItems with pagination
→ fetch selected media into browser memory
→ Blob → File[] → ChatGPT
→ DELETE the Picker session
```

The extension prefers `chrome.identity.getAuthToken({ interactive: false })`. It uses `interactive: true` only after a user action and only when Chrome reports that interaction is required. A rejected cached token is removed before one silent refresh attempt.

## Privacy

The project has no custom backend, analytics, or telemetry. Google OAuth is managed by Chrome and Google Identity. OAuth tokens are not displayed to users, written to repository files, or stored in extension storage. Selected photo bytes are handled in browser memory and are given to ChatGPT only after the user explicitly selects them.

Read the full [Privacy Policy](PRIVACY.md) or [简体中文隐私政策](PRIVACY.zh-CN.md).

## Permissions

| Permission | Purpose |
|---|---|
| `identity` | Obtains and refreshes Google OAuth tokens through Chrome Identity. |
| `storage` | Stores temporary Picker/job state and a non-sensitive disconnect preference. It never stores OAuth tokens or photo bytes. |
| `activeTab` | Lets the popup act on the ChatGPT tab selected by the user. |
| `alarms` | Expires and refreshes standby Picker sessions while the MV3 service worker sleeps. |
| `https://chatgpt.com/*` | Adds the shortcut and hands selected files to the active ChatGPT composer. |
| `https://photospicker.googleapis.com/*` | Creates, polls, lists, and deletes Picker sessions. |
| `https://lh3.googleusercontent.com/*` | Downloads only media returned by the user's Picker selection. |

The extension Content Security Policy allows local scripts only: `script-src 'self'; object-src 'self'`.

## Screenshots / demo

Screenshots and the OAuth review demo video will be added after the production OAuth configuration has been verified. The required capture list and an exact video script are prepared in [docs/GOOGLE_OAUTH_VERIFICATION.md](docs/GOOGLE_OAUTH_VERIFICATION.md).

## Development

Development, fork, and self-hosted OAuth configuration is intentionally separate from the normal-user installation path. See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

The complete quality suite is:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:dist
```

## Known limitations

- Google Photos API applications must pass Google's applicable OAuth review before public use. Repository code cannot reveal the Cloud project's current Audience, Publishing status, branding status, or data-access verification status.
- A Google OAuth app in Testing mode only works for configured test users; this is a Google Cloud configuration limit, not an extension-side login feature.
- Microsoft Edge does not support Chrome's `identity.getAuthToken` API. An Edge OAuth build needs a separately reviewed `launchWebAuthFlow` design and compatible public OAuth client; v1.1.0 must not pretend the Chrome OAuth path works in Edge.
- ChatGPT is a frequently updated SPA without a stable third-party attachment API. The extension uses semantic elements and standard browser events, but future changes may require an update.
- ChatGPT controls accepted file formats, file-size limits, multi-image limits, and server-side upload behavior.
- WEBP, HEIC, and HEIF are passed through with their Google-provided MIME types, but ChatGPT may reject unsupported formats.
- Videos returned by the Picker are skipped because this project targets image attachments.

See [troubleshooting.md](troubleshooting.md) for diagnostics.

## Contributing

Issues and focused pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and run the full quality suite before submitting changes. Never include access tokens, credentials, private photo URLs, or personal filenames in an issue.

Security reports should follow [SECURITY.md](SECURITY.md).

## License

Released under the [MIT License](LICENSE).
