# Troubleshooting

## Connect Google Photos is shown

This is the normal first-use or disconnected state. Open ChatGPT and click the Google Photos icon, or click **Connect Google Photos** in the extension popup. Complete Google's official authorization screen; the Picker should open automatically without a second click.

The extension never asks you to copy a token, enter a Client ID, create a Google Cloud project, or type your Google password into the extension.

## Authorization expired or failed

Use **Reconnect** in the popup or options page. The extension clears its Chrome Identity state and starts the official Google authorization flow after your click.

If Google says the app is unavailable to your account, the maintainer's OAuth app may still be in Testing or awaiting verification. Ordinary users cannot fix that locally and should not create or paste credentials. See the repository release status or contact the maintainer.

## Disconnect Google Photos

**Disconnect Google Photos** clears this extension's Chrome Identity state, removes any standby Picker session, and suppresses background prewarming until you connect again. It does not store or transmit a token.

## Developer build: OAuth is not configured

Symptoms: the popup action is disabled or reports that the OAuth Client ID is missing.

```bash
npm run configure-oauth -- "YOUR_CLIENT_ID.apps.googleusercontent.com"
npm run build
```

Reload the extension and the ChatGPT tab afterward.

## Developer build: bad Client ID

Verify all of the following:

1. The OAuth client type is **Chrome Extension**.
2. Its item ID is `igacbcmbkglkglkindhcpmagafnboolj`.
3. The client belongs to the Google Cloud project where the Google Photos Picker API is enabled.
4. `dist/manifest.json` does not contain the `REPLACE_WITH_` placeholder.
5. The extension was rebuilt and reloaded after changing the client ID.
6. No Client Secret is configured; Chrome Extension clients do not use one.

## Access blocked, app not verified, or HTTP 403

- If the OAuth app is External and in testing, add the current Google account under **Test users**.
- Add only `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` for Photos access.
- Enable **Google Photos Picker API**, not Google Picker API or the legacy Photos Library API.
- After changing consent settings, use **Reconnect** in the extension popup and try again.

Only continue an unverified-app warning for a Google Cloud project you control and recognize.

## HTTP 401 or expired token

The extension removes a rejected token from Chrome's identity cache and retries once. If the request still fails:

1. Use **Reconnect** in the extension popup.
2. Confirm that the browser profile is signed in to the intended Google account.
3. Start the Picker again.
4. If several Google accounts are signed in, use the same account in the Picker that authorized the session.

## Picker window does not open

- Confirm that browser or enterprise policy allows extensions to create windows.
- Start from either the extension popup or the icon beside the ChatGPT composer.
- Inspect the extension service worker from `chrome://extensions` for a sanitized error.
- Reload the extension and ChatGPT, then retry.

The preload uses an unfocused, minimized popup rather than adding a permanent tab to the main browser window. Closing an unused preloaded popup suppresses immediate recreation, preventing a close/reopen loop.

## Picker closed or user cancelled

Closing before **Done** cancels the job and deletes the session. Cancellation is intentionally quiet. Start a new selection when ready.

The Picker uses Google's `/autoclose` URL after **Done**. The extension checks the session again to distinguish completion from an early close.

## Picker timed out

The extension follows Google's `pollingConfig.pollInterval`, `timeoutIn`, and session `expireTime`. A timeout can mean the Picker was left open too long, the API was blocked by the network, or the browser forcibly terminated the extension worker.

Reload ChatGPT and start a new session.

## No photos selected

Open the Picker again, select at least one photo, and press **Done**. Videos are skipped because this extension targets image attachments.

## A file was skipped for size

The extension performs a 20 MB precheck and stops reading a stream that exceeds the limit. Select a smaller image or resize it before using the extension. The extension does not silently reduce image quality.

## WEBP, HEIC, or HEIF does not appear

The extension preserves the Google-provided MIME type and hands the file to ChatGPT, but ChatGPT may reject a format it does not currently support. Try JPEG or PNG and review the native ChatGPT error.

Run the Phase 2 diagnostic to confirm that the attachment injection itself still works.

## Could not find a usable file input

The extension tries, in order:

1. Semantic `input[type=file]` candidates near the current composer.
2. `DataTransfer` assignment with `input` and `change` events.
3. A `MutationObserver` for a dynamically created file input.
4. Standard drag-and-drop events on the active composer.

Confirm that `https://chatgpt.com/` is fully loaded and that no login page, challenge, or modal covers the composer. Reload the page and run the Phase 2 diagnostic. If Phase 2 also fails, ChatGPT's DOM may have changed.

## Files were handed to ChatGPT, but the attachment UI was not verified

The file input may have consumed the files before the extension observed a preview mutation. Check the composer visually and wait for any upload progress. To avoid duplicate photos, the extension does not retry with drag-and-drop after it has evidence that an input consumed the files.

## Only some selected photos appeared

- Review warnings for skipped files.
- Confirm each file is within the target's current limit.
- ChatGPT's multi-image limits can vary with file size, conversation, and account.
- The extension submits the complete `File[]` to a multiple input or drop target; it does not intentionally select files one by one.

## ChatGPT tab was closed or navigated away

If the target tab disappears before completion, the extension stops the job and cleans up the session. Open the final conversation before starting the Picker. Normal ChatGPT SPA navigation and redraws are handled by the content script.

## Phase 1 and Phase 2 diagnostics

Open the extension popup and expand **Setup & developer tests**.

- Phase 1 failure points to OAuth, Picker API, Google account, download, or token handling.
- Phase 1 success plus Phase 2 failure points to ChatGPT DOM/attachment injection.
- Both diagnostics succeeding while a real selection fails points to file format, size, selected count, network, or a ChatGPT server-side response.

## Inspecting logs safely

Service worker:

```text
chrome://extensions → Google Photos for ChatGPT → Service worker → Inspect
```

Content script:

```text
ChatGPT tab → DevTools → Console
```

The production extension does not print OAuth access tokens or photo bytes. Detailed timing output is compiled only by `npm run build:debug`. Before sharing logs, remove personal filenames, URLs, account identifiers, and conversation content.

## Clean reset

1. Use **Disconnect Google Photos**, then connect again.
2. Close any remaining Picker window.
3. Reload the extension.
4. Reload ChatGPT.
5. Start a new selection.

There is no need to clean Windows Downloads because the extension does not intentionally write files there.
