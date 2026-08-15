# Security policy

## Supported versions

Security fixes are applied to the latest published release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting feature for this repository when available. Do not open a public issue containing access tokens, refresh tokens, credentials, private media URLs, personal filenames, or private account information.

Include a concise impact description, affected version, reproduction steps with sanitized data, and any suggested mitigation. Never send a real Google or GitHub credential as a proof of concept.

## Project security model

- The extension has no custom backend.
- Google OAuth tokens are obtained through `chrome.identity`.
- Selected media is held in memory and handed to the active ChatGPT page after explicit user selection.
- Temporary Picker state is stored in `chrome.storage.session`; image bytes and OAuth tokens are not stored there.
- The production build uses a local-only extension page Content Security Policy.
