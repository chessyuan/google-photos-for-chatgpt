# Security policy

## Supported versions

Security fixes are applied to the latest published release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository when available. Do not open a public issue containing access tokens, refresh tokens, credentials, private media URLs, personal filenames, or private account information.

Include a concise impact description, affected version, reproduction steps with sanitized data, and any suggested mitigation. Never send a real Google or GitHub credential as a proof of concept.

## Project security model

- The extension has no custom backend.
- Google OAuth is performed through `chrome.identity` and Google's official OAuth endpoints.
- Selected media is held in memory and handed to the active ChatGPT page after explicit user selection.
- Temporary Picker state is stored in `chrome.storage.session`. Chooser authorization is stored in `chrome.storage.local` restricted to `TRUSTED_CONTEXTS`, with a session copy; neither token copy is exposed to the ChatGPT content script. Tokens keep Google's expiry and are removed on disconnect. Silent renewal requires a verified account identifier and verifies the replacement token belongs to that account. Image bytes are not stored there.
- The extension contains no Client Secret, refresh token, private key, analytics, telemetry, or maintainer-operated token service.
- The production build uses a local-only extension page Content Security Policy.

See [OAuth, privacy, and architecture](docs/OAUTH_PRIVACY_AND_ARCHITECTURE.md) for the full trust boundary and data flow.
