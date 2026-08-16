# Google Photos for ChatGPT v1.1.0

## One-click Google Photos authorization

v1.1.0 simplifies the extension for normal users:

- No manual OAuth setup for normal release users.
- Choose and authorize the intended Google account through Google's official account chooser after an explicit click.
- Automatically continue from first authorization to the Google Photos Picker.
- Reuse a valid short-lived browser-session token silently on later clicks.
- Automatically invalidate a rejected cached token and request reconnection only when needed.
- View Connected, Choose another account, and Disconnect controls without seeing Client IDs or tokens.
- Use the extension in English or Simplified Chinese according to the Chrome UI language.
- Open Privacy Policy links directly from the popup and options page.
- Reliably continue from first authorization to the Picker without a second token lookup.
- Recover from interrupted MV3 startup jobs and bound Picker API requests so **Opening Google Photos…** cannot remain indefinitely.

All safe Picker startup optimizations remain in place, including standby sessions, atomic consumption, expiration handling, MV3 alarms, cache-hit startup, and OAuth/API fallback. The extension does not keep a hidden Google Photos page or repeatedly reopen a background tab.

## Privacy and security

- No maintainer-operated backend, analytics, telemetry, Client Secret, refresh token, or private key.
- The chooser-mode short-lived access token is stored only in `chrome.storage.session` and is cleared on disconnect or browser-session end.
- Selected photo bytes stay in browser memory until they are handed to the active ChatGPT attachment interface.
- The repository was scanned for credentials, private keys, tokens, personal email addresses, and local personal paths before publication.

Read [OAuth, privacy, and architecture](OAUTH_PRIVACY_AND_ARCHITECTURE.md) for the complete model.

> Release gate: the code may be reviewed and tested now, but do not describe v1.1.0 as unrestricted public OAuth access until the maintainer verifies that the production Google OAuth app is External, In production, and approved for the Google Photos Picker scope without a Test User restriction. Testers may currently see Google's unverified-app warning or be limited to configured Test Users.
