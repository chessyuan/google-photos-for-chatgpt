# Contributing

Thank you for helping improve Google Photos for ChatGPT.

## Before opening an issue

- Search existing issues first.
- Do not include OAuth tokens, credentials, private photo URLs, private filenames, or account data.
- For attachment failures, say whether the Phase 1 and Phase 2 diagnostics succeed.
- Include Chrome or Edge version, extension version, and a redacted error message.

## Development workflow

1. Fork the repository and create a focused branch.
2. Install dependencies with `npm install`.
3. Configure your own Chrome Extension OAuth client in `.env.local` if the change needs the real Picker.
4. Keep OAuth, Picker, and ChatGPT attachment changes narrowly scoped.
5. Add or update tests for behavior changes.
6. Run:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run build
   npm run verify:dist
   ```

7. Explain user-visible behavior and test evidence in the pull request.

## Pull request guidelines

- Do not commit `.env.local`, credentials, tokens, private keys, logs, or real photo data.
- Do not add legacy Google Photos Library scopes.
- Avoid selectors based on ChatGPT's generated CSS class names.
- Preserve cancellation, session deletion, and service-worker recovery behavior.
- Do not add analytics, a remote server, or new permissions without a clear proposal and privacy rationale.

By contributing, you agree that your contribution is licensed under the MIT License.
