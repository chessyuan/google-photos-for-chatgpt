# Privacy Policy — Google Photos for ChatGPT

Last updated: October 17, 2026

Google Photos for ChatGPT is an independent, open-source browser extension. It is not affiliated with, endorsed by, or sponsored by Google or OpenAI.

## Summary

The extension has no custom backend, analytics, advertising, or telemetry. It uses Chrome Identity and Google OAuth to let a user explicitly select images and videos through the Google Photos Picker. Selected media are processed in the browser and are handed to ChatGPT only after the user chooses them. The `scripting` permission reattaches the bundled local content script to already-authorized ChatGPT tabs after extension updates without reloading page drafts.

## Google authorization

Video download redirects may reach Google's `*.googlevideo.com` CDN. The extension requests host access to that domain family for selected video bytes; content-script injection remains limited to ChatGPT and the Google OAuth scope is unchanged.

- Authorization is performed by Chrome's `chrome.identity` API and Google's OAuth service. Account changes use Google's official account chooser when the release Web OAuth client is configured.
- The extension never asks the user to type a Google password into the extension.
- The extension requests only `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` for Google Photos access.
- This scope permits the extension to create, inspect, and delete Picker sessions and to list only the media items the user selected for a Picker session.
- The extension does not display OAuth tokens to users, transmit them to a project-controlled server, or write them to repository files, web `localStorage`, or Downloads. Chooser-mode access tokens are short-lived and kept in `chrome.storage.local` restricted to `TRUSTED_CONTEXTS`, with a session copy, so a still-valid login survives a browser restart or extension reload. They are not exposed to the ChatGPT content script.
- Disconnect clears local authorization state, removes the session token, asks Google's official revoke endpoint to revoke it when chooser mode is active, and stores only a non-sensitive boolean preference so background prewarming remains disabled until the user reconnects.

## Photo data

- The extension accesses only media items returned after the user actively selects them in the official Google Photos Picker.
- Selected media bytes are downloaded directly from the Google-provided media URL into browser memory.
- Media bytes are temporarily represented as `Blob` and `File` objects and are handed to the active ChatGPT attachment interface.
- The extension does not intentionally save selected photos to Downloads or a project-controlled server.
- The extension does not use selected photos for advertising, analytics, profiling, model training, or any unrelated purpose.

## Temporary extension data

`chrome.storage.session` may temporarily contain Picker session identifiers, expiration timestamps, polling configuration, window/tab identifiers, transfer metadata, filenames, MIME types, job status, warnings, and performance timestamps. This supports Manifest V3 service-worker recovery and is cleared when the browser session ends.

`chrome.storage.local` stores the explicit disconnect preference and, in chooser mode, the short-lived access token, Google-issued expiry, selected-account identifier and selection timestamp. Tokens retain Google's original lifetime. Expired tokens cannot authorize requests; renewal uses a hidden Google flow only for the verified selected account. If Google requires consent or sign-in, the next user action requests authorization. No storage area contains a refresh token, Client Secret, photo bytes, Google password, or private key. Disconnect removes both copies of the authorization and the account identifier.

## Data sharing

The extension communicates with:

- Google OAuth / Chrome Identity for authorization.
- `photospicker.googleapis.com` to manage Picker sessions and list the user's explicit selection.
- Google-provided media hosts to retrieve selected photo bytes.
- `chatgpt.com` to hand the selected files to the user's active ChatGPT conversation.

The project operator does not receive this data because the project has no backend. Google and OpenAI process data under their own terms and privacy policies.

## Retention and deletion

- Chrome-profile fallback tokens remain in Chrome Identity's cache. Chooser-mode tokens remain in trusted extension storage. Both are cleared locally with **Disconnect Google Photos**.
- Picker sessions are deleted after completion, cancellation, expiration, or failure when cleanup is available. Google also expires Picker sessions server-side.
- Photo bytes are held only for the active in-memory transfer and are not retained by the extension after the operation or browser context ends.
- Temporary `chrome.storage.session` data ends with the browser session.
- The disconnect preference can be removed by reconnecting or uninstalling the extension.

## Security

The production extension uses Manifest V3 and a local-only extension-page Content Security Policy. It does not load remote executable code. The source code and build output are publicly reviewable in this repository.

Do not post access tokens, private photo links, account information, or personal filenames in a public issue. Report security concerns through the process in [SECURITY.md](SECURITY.md).

## Changes to this policy

Material changes will be documented in the repository and reflected in the “Last updated” date. Changes that affect Google user data use may also require an updated OAuth review before release.

## Contact

For general, non-sensitive questions, open an issue at <https://github.com/chessyuan/google-photos-for-chatgpt/issues>. For security-sensitive reports, follow <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/SECURITY.md>.
