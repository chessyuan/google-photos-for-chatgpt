# Google Photos for ChatGPT v1.1.0

## One-click Google Photos authorization

v1.1.0 simplifies the extension for normal users:

- No manual OAuth setup for normal release users.
- Sign in with and authorize your own Google account after an explicit click.
- Automatically continue from first authorization to the Google Photos Picker.
- Reuse valid Chrome Identity authorization silently on later clicks.
- Automatically invalidate a rejected cached token and request reconnection only when needed.
- View Connected, Reconnect, and Disconnect controls without seeing Client IDs or tokens.
- Use the extension in English or Simplified Chinese according to the Chrome UI language.
- Open Privacy Policy links directly from the popup and options page.
- Reliably continue from first authorization to the Picker without a second token lookup.
- Recover from interrupted MV3 startup jobs and bound Picker API requests so **Opening Google Photos…** cannot remain indefinitely.

All existing Picker startup optimizations remain in place, including standby sessions, atomic consumption, expiration handling, MV3 alarms, minimized page preload, cache-hit startup, and OAuth/API fallback.

> Release gate: publish these notes only after the maintainer verifies that the production Google OAuth app is External, In production, and approved for the Google Photos Picker scope without a Test User restriction.
