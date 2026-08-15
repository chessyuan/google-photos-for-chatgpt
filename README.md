# Google Photos for ChatGPT

Google Photos for ChatGPT is a local-first Chrome Extension that lets you select cloud photos with the official Google Photos Picker and attach them directly to a ChatGPT conversation.

It removes the usual download-and-reselect workflow:

```text
ChatGPT → Google Photos Picker → select one or many photos → Done
        → photos appear in the ChatGPT attachment area
```

No Windows file chooser is opened, no photo is intentionally saved to Downloads, and no companion server is required.

> This project is an independent open-source project and is not affiliated with, endorsed by, or sponsored by Google or OpenAI.

## Why this project exists

Moving several photos from Google Photos to ChatGPT normally means downloading them to the computer and selecting the same files again. This ChatGPT extension keeps the transfer in the browser: it uses Google OAuth and the current Google Photos Picker API, downloads the selected media into memory, creates browser `File` objects, and hands them to ChatGPT's attachment UI.

## Features

- Official Google Photos Picker with single- and multi-select.
- Current read-only Picker scope: `https://www.googleapis.com/auth/photospicker.mediaitems.readonly`.
- JPEG, PNG, WEBP, GIF, HEIC, and HEIF handoff when the target supports the format.
- Original filename and Google-provided MIME type preservation.
- In-memory media processing; no intentional writes to Downloads.
- Fast repeat launches through a standby Picker session stored in `chrome.storage.session`.
- Atomic standby-session consumption, expiration handling, and MV3 alarm refresh.
- Optional minimized Picker-page preload so an already-authorized launch can feel immediate.
- OAuth and API fallback when a prewarmed session is unavailable.
- A stable, icon-only Google Photos shortcut next to the ChatGPT composer.
- SPA redraw recovery without relying on hashed ChatGPT CSS classes.
- File-input, `MutationObserver`, and drag-and-drop attachment strategies.
- Bounded parallel downloads and resilient per-file error handling.
- Chrome and Chromium-based Edge support with Manifest V3.

## Screenshots / demo

Screenshots and an animated demo are planned for a future documentation update. The extension UI is intentionally minimal: a four-color Google Photos icon appears just outside the left side of the ChatGPT composer, next to the native attachment control.

## Installation

### Install the release ZIP

1. Download `google-photos-for-chatgpt-v1.0.0.zip` from the [latest release](https://github.com/chessyuan/google-photos-for-chatgpt/releases/latest).
2. Extract the ZIP to a permanent folder.
3. Open `chrome://extensions` in Chrome or `edge://extensions` in Edge.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `google-photos-for-chatgpt-v1.0.0` folder—the folder whose root contains `manifest.json`.
7. Reload any already-open `https://chatgpt.com/` tab.

### Load the repository build directly

The repository includes a ready-to-load `dist/` directory:

```text
chrome://extensions → Developer mode → Load unpacked → select dist
```

The manifest public key keeps the unpacked extension ID stable:

```text
igacbcmbkglkglkindhcpmagafnboolj
```

The release build contains a Chrome Extension OAuth Client ID. OAuth client IDs used by installed client applications are public identifiers, not client secrets. Access is still controlled by the Google Cloud OAuth consent configuration. If the bundled OAuth app does not authorize your Google account, build the extension with your own Chrome Extension OAuth client as described below.

## Usage

1. Sign in to Google Photos and ChatGPT in the same browser profile.
2. Open the ChatGPT conversation that should receive the images.
3. Click the four-color Google Photos icon next to the composer, or use the extension popup.
4. Complete Google authorization on first use.
5. Select one or more photos in the official Google Photos Picker and click **Done**.
6. Wait for the photos to appear in the ChatGPT attachment area, then send normally.

Closing the Picker before pressing **Done** is treated as cancellation. The extension cleans up the Picker session and does not show a persistent page error.

## Development

### Requirements

- Node.js 22 or newer.
- npm.
- Chrome 120+ or a current Chromium-based Edge release.
- A Google Cloud project with the Google Photos Picker API enabled.

Install dependencies:

```bash
npm install
```

Copy the environment template or use the helper command:

```bash
npm run configure-oauth -- "YOUR_CLIENT_ID.apps.googleusercontent.com"
```

This writes the client ID to the ignored `.env.local` file. Do not add a Client Secret, access token, refresh token, private key, or credentials file to this project.

Start Vite for extension-page development:

```bash
npm run dev
```

Create a debug build with performance logging:

```bash
npm run build:debug
```

Production builds do not emit the detailed performance trace.

## Build

```bash
npm run build
npm run verify:dist
```

The build produces a Manifest V3 extension in `dist/`. `verify:dist` checks required files, the OAuth scope, production source-map exclusion, and manifest settings.

## Test

Run the complete local quality suite:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run verify:dist
```

The extension popup also exposes two developer diagnostics:

- **Phase 1:** Google Photos → in-memory bytes → `File[]` → ordinary multiple file input.
- **Phase 2:** synthetic in-memory PNG files → ChatGPT attachment injection, without calling Google Photos.

See [PERFORMANCE.md](PERFORMANCE.md) for measured local data-path and real-browser synthetic attachment results.

## Google Photos Picker and OAuth

The extension uses this lifecycle:

```text
chrome.identity OAuth
→ POST https://photospicker.googleapis.com/v1/sessions
→ open pickerUri/autoclose
→ poll the session using Google's pollingConfig
→ GET /v1/mediaItems with pagination
→ fetch selected media into memory
→ Blob → File[] → ChatGPT
→ DELETE the Picker session
```

Only the current Google Photos Picker scope is requested:

```text
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
```

The extension does not request the legacy `photoslibrary.readonly` scope.

### Configure your own Google OAuth client

1. Create a project in [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Photos Picker API** (`photospicker.googleapis.com`).
3. Configure the OAuth consent screen / Google Auth Platform branding and audience.
4. Add the Picker read-only scope shown above.
5. If the OAuth app is in testing, add the Google accounts that will use it as test users.
6. Create an OAuth client with application type **Chrome Extension**.
7. Set the extension item ID to `igacbcmbkglkglkindhcpmagafnboolj`.
8. Run `npm run configure-oauth -- "YOUR_CLIENT_ID.apps.googleusercontent.com"`.
9. Rebuild and reload the unpacked extension.

Chrome Extension OAuth clients do not use a Client Secret. The manifest `key` is the extension's public key used to derive a stable extension ID; it is not a private signing key.

## Privacy

- The project has no custom backend, analytics, or telemetry.
- OAuth access tokens are managed by `chrome.identity`; they are not written to repository files or Downloads.
- Selected image bytes are processed in browser memory and are not stored in `chrome.storage`.
- `chrome.storage.session` contains temporary job state, Picker session identifiers, expiration data, preload window/tab identifiers, short-lived media metadata, and readiness flags so the MV3 service worker can recover after sleeping.
- Picker sessions are deleted after completion, cancellation, expiration, or failure.
- Photos are sent to ChatGPT only after the user selects them and confirms the Picker. OpenAI's handling of uploaded files is governed by the user's ChatGPT account and settings.

Review the source before using the extension with sensitive photos. Never publish logs that may contain personal filenames or other account-specific context.

## Permissions explanation

| Permission | Why it is needed |
|---|---|
| `identity` | Obtains and refreshes the Google OAuth token through Chrome's identity API. |
| `storage` | Stores ephemeral Picker/job state in `chrome.storage.session` for MV3 service-worker recovery. |
| `activeTab` | Lets the popup act on the ChatGPT tab the user explicitly selected. |
| `alarms` | Refreshes or expires standby Picker sessions even when the service worker sleeps. |
| `https://chatgpt.com/*` | Injects the shortcut and hands selected files to the current ChatGPT composer. |
| `https://photospicker.googleapis.com/*` | Creates, polls, lists, and deletes Google Photos Picker sessions. |
| `https://lh3.googleusercontent.com/*` | Downloads the media selected by the user from the Picker-provided URL. |

The extension page Content Security Policy allows only local scripts and objects: `script-src 'self'; object-src 'self'`.

## Known limitations

- ChatGPT is a frequently updated SPA and does not expose a stable third-party attachment DOM API. The extension uses semantic elements and standard browser events, but a future ChatGPT redesign may require an update.
- ChatGPT's accepted formats, per-file size limits, and multi-image limits are controlled by OpenAI and may vary by product state or account.
- WEBP, HEIC, and HEIF are passed through with their original MIME types, but ChatGPT may reject a format it does not currently support.
- Videos returned by the Picker are skipped because this project targets image attachments.
- Google OAuth apps in testing mode only authorize configured test users. Public distribution may require the OAuth app owner to complete Google's publication or verification requirements, or users can build with their own OAuth client.
- A true private-photo end-to-end test requires a user to make a real Picker selection; automated tests intentionally use synthetic images.

See [troubleshooting.md](troubleshooting.md) for common OAuth, Picker, and ChatGPT attachment problems.

## Contributing

Issues and focused pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), keep changes narrowly scoped, and run the full quality suite before submitting a pull request.

Security issues should be reported according to [SECURITY.md](SECURITY.md), not through a public issue containing credentials or private photo information.

## License

Released under the [MIT License](LICENSE).
