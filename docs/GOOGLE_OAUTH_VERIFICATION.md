# Google OAuth production and verification submission pack

Prepared: August 15, 2026

## Current status: OWNER ACTION REQUIRED

The repository and production manifest prove the extension's client-side behavior, fixed extension ID, OAuth client ID, and requested scope. They **do not** expose the private Google Cloud Console fields needed to verify public OAuth availability.

The following current values are unknown and must be checked by a project Owner or Editor in Google Cloud Console:

- Audience: External or Internal.
- Publishing status: Testing or In production.
- Branding status: Draft, verified, or published.
- Data Access classification shown for `photospicker.mediaitems.readonly`.
- OAuth verification status for that scope.
- Remaining test-user or unverified-user cap restrictions.
- Whether the Chrome Web Store has a registered item with ID `igacbcmbkglkglkindhcpmagafnboolj`.
- Whether a separate Edge-compatible OAuth client and reviewed `launchWebAuthFlow` design will be created; the current Chrome client cannot use Edge's unsupported `getAuthToken` path.

Google's Google Photos authorization documentation states that applications accessing Google Photos APIs must pass OAuth verification review. A Testing app is limited to configured test users; an In production app is available to Google Accounts subject to applicable verification and organization policies.

Do not publish v1.1.0 as “available to every Google user” until the evidence checklist below is complete.

## Verified from the source and build

- App name: **Google Photos for ChatGPT**.
- Repository: <https://github.com/chessyuan/google-photos-for-chatgpt>.
- Current release: <https://github.com/chessyuan/google-photos-for-chatgpt/releases/tag/v1.0.0>.
- Planned release: `v1.1.0` — not published while this gate remains open.
- Fixed Chrome Extension ID: `igacbcmbkglkglkindhcpmagafnboolj`.
- Production Chrome Extension OAuth Client ID: `43154637059-a8t1kbv88cv9kj51edigsluh0gkbvn2m.apps.googleusercontent.com`.
- Google Photos scope: `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` only.
- No legacy `photoslibrary.readonly` scope.
- No Client Secret, password collection, token backend, analytics, or telemetry.

## Owner console checklist

Record dated screenshots or exported text for each item. Redact project numbers only when they are not the public OAuth client identifier; never expose tokens or private credentials.

1. Open the Google Cloud project that owns the production Client ID above.
2. In **Google Auth Platform → Audience**, confirm **External**.
3. Record **Publishing status**. If it is Testing, ordinary users are still blocked unless added as test users. Move to **In production** when the production app is ready.
4. In **Branding**, set and verify:
   - App name: `Google Photos for ChatGPT`.
   - User support email: `[OWNER SUPPORT EMAIL — REQUIRED]`.
   - App description matching the text below.
   - Homepage URL on a domain the owner controls and can verify.
   - Privacy Policy URL on that same verified domain.
   - Terms URL if supplied.
   - Developer contact email: `[OWNER DEVELOPER CONTACT — REQUIRED]`.
5. Verify ownership of every configured domain in Google Search Console. Google requires production OAuth home/privacy/terms domains to be owned or authorized by the app owner. GitHub repository links are public documentation, but the owner must confirm whether the verification flow accepts the chosen host; the safest production choice is a custom domain owned and verified by the maintainer.
6. In **Data Access**, declare exactly `https://www.googleapis.com/auth/photospicker.mediaitems.readonly` and remove obsolete Photos Library scopes from the production project if they are not used by another production client.
7. Record the exact category Google Cloud displays for this scope: non-sensitive, sensitive, or restricted. Do not infer this value from a blog post or source code.
8. In **Clients**, confirm the OAuth client type is **Chrome Extension** and its item ID is exactly `igacbcmbkglkglkindhcpmagafnboolj`.
9. In the Chrome Web Store Developer Dashboard, confirm a registered item exists with the same extension ID. Google's installed-app verification guidance requires a registered Chrome Web Store item matching the Chrome Extension OAuth client under review.
10. Publish branding if it is still Draft and complete Brand Verification when offered.
11. Open **Verification Center** and submit Data Access verification for the Photos Picker scope. Provide the justification, reviewer steps, video, and screenshots below.
12. Monitor the support/developer-contact inboxes for questions from Google's OAuth review team.
13. After approval, capture evidence showing:
    - Audience: External.
    - Publishing status: In production.
    - Branding: verified and published.
    - Data Access / scope: approved or verified.
    - No test-user-only restriction for ordinary consumer Google Accounts.
14. Test with a Google Account that was never added as a Test User. Install a fresh v1.1.0 candidate, authorize, open the Picker, choose one photo, press Done, and confirm the photo appears in ChatGPT.

Only after steps 1–14 are verified should the maintainer remove the README release gate and publish `v1.1.0`.

## Public policy URLs

Repository copies prepared now:

- Homepage: <https://github.com/chessyuan/google-photos-for-chatgpt>.
- Privacy Policy: <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/PRIVACY.md>.
- Chinese Privacy Policy: <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/PRIVACY.zh-CN.md>.
- Terms: <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/TERMS.md>.
- Security: <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/SECURITY.md>.

For production OAuth verification, publish equivalent pages under a stable custom domain owned and verified by the maintainer:

- `https://[OWNER-VERIFIED-DOMAIN]/google-photos-for-chatgpt/`
- `https://[OWNER-VERIFIED-DOMAIN]/google-photos-for-chatgpt/privacy/`
- `https://[OWNER-VERIFIED-DOMAIN]/google-photos-for-chatgpt/terms/`

Replace every placeholder before submission.

## Submission text

### App name

Google Photos for ChatGPT

### Short description

A Google Chrome extension that lets users explicitly select photos with the official Google Photos Picker and attach those selected photos to their active ChatGPT conversation.

### Full description

Google Photos for ChatGPT removes the manual download-and-reselect step between Google Photos and ChatGPT. After a user clicks the extension, Chrome and Google OAuth request the minimum Google Photos Picker permission. The extension creates an official Picker session, the user explicitly selects one or more photos, and only those selected files are processed in browser memory and handed to the active ChatGPT attachment interface. The project has no custom backend, analytics, telemetry, advertising, password collection, or unrelated use of Google user data.

The project is independent and is not affiliated with, endorsed by, or sponsored by Google or OpenAI.

### Scope justification

Requested scope:

```text
https://www.googleapis.com/auth/photospicker.mediaitems.readonly
```

Justification:

> Google Photos for ChatGPT needs this scope to create, read, and delete Google Photos Picker sessions and to list only the media items that a user explicitly selected in that Picker session. The extension then retrieves the selected photo bytes from Google-provided URLs into browser memory and hands those files to the user's active ChatGPT attachment interface. The extension cannot provide its core “select photos from Google Photos and attach them to ChatGPT” feature without this scope. It does not need access to the user's full Photos library and therefore does not request legacy or broader Photos Library scopes.

### Data handling statement

> Google user data is used only to complete the photo-selection action initiated by the user. OAuth tokens are managed by Chrome Identity and are not stored in extension storage or sent to a project-controlled server. Selected photo bytes are processed in browser memory, sent only to the user's active ChatGPT page, and are not retained by the extension after the operation. The project has no backend, analytics, telemetry, advertising, or sale of user data.

## Reviewer instructions

1. Use a supported desktop Chrome profile and sign in to a Google Account with Google Photos content.
2. Install the provided Chrome Web Store review item or the exact unpacked review build with extension ID `igacbcmbkglkglkindhcpmagafnboolj`.
3. Open `https://chatgpt.com/`, sign in, and open a conversation.
4. Click the four-color Google Photos icon immediately to the left of the ChatGPT composer.
5. On first use, click **Connect Google Photos** if the popup is open, or continue from the icon click.
6. Complete the Google OAuth screen. Verify that the app name is **Google Photos for ChatGPT** and that only the Google Photos Picker read-only permission is requested.
7. Confirm that authorization automatically continues to the official Google Photos Picker without a second extension click.
8. Select one or more photos and press **Done**.
9. Confirm that the Picker closes and the selected images appear in the ChatGPT attachment area.
10. Do not send the ChatGPT message unless needed for review; attachment appearance proves the extension handoff.
11. Open the extension popup and confirm **Connected / Google account authorized**.
12. Click **Disconnect Google Photos**, confirm the UI changes to disconnected, and verify the next user click starts the normal authorization flow again.

Reviewer test account notes: `[OWNER: provide only through Google's secure reviewer field; never commit credentials]`.

## Demo video script

Record in English, in one continuous capture when possible. Upload as an unlisted YouTube video if Google requests that format.

1. Show the public homepage, Privacy Policy, Terms, and support contact.
2. Show the Chrome extension details page with the extension name and ID `igacbcmbkglkglkindhcpmagafnboolj`.
3. Open the extension popup in a fresh or disconnected state and show **Connect Google Photos**.
4. Open ChatGPT and click the Google Photos icon.
5. Show the complete Google OAuth grant flow. Keep the browser address bar visible and show that the consent screen displays **Google Photos for ChatGPT** and the production OAuth client involved in the request.
6. Show the exact requested Picker permission; do not skip or edit around the consent screen.
7. Approve access and show that the same click automatically proceeds to the official Google Photos Picker.
8. Select two non-sensitive demonstration photos and press **Done**.
9. Show the Picker closing and both photos appearing in the ChatGPT attachment area.
10. Reopen the Picker to demonstrate that an authorized user is not asked to authorize again.
11. Open the popup/options page and show **Connected**, **Reconnect**, **Disconnect**, and the Privacy Policy links.
12. Disconnect, click the icon again, and show that the extension returns to the official authorization flow.
13. End on a data-flow slide: Google OAuth/Picker → browser memory → active ChatGPT page; no custom backend, analytics, telemetry, token storage, or password collection.

Do not reveal real tokens, private filenames, personal photos, email inboxes, Cloud credentials, or unrelated browser data in the recording.

## Required screenshots checklist

- Public homepage with app description and policy links.
- English Privacy Policy page.
- Terms page.
- Chrome extension details page showing app name and matching extension ID.
- Popup disconnected state: **Connect Google Photos**.
- Google consent screen showing app name and requested Picker access.
- Official Google Photos Picker with safe demonstration media.
- ChatGPT composer with selected demo photos attached.
- Popup connected state: **Connected / Google account authorized**.
- Reconnect and Disconnect controls.
- Simplified Chinese authorization UI.
- Google Cloud Audience page showing External and In production.
- Google Cloud Branding page showing verified/published status and public policy URLs.
- Google Cloud Data Access / Verification Center showing the exact scope classification and approved status.
- Chrome Web Store item showing the matching extension ID.

## Contact placeholders

- User support email: `[OWNER SUPPORT EMAIL — REQUIRED]`.
- Developer contact email: `[OWNER DEVELOPER CONTACT — REQUIRED]`.
- Security contact/process: <https://github.com/chessyuan/google-photos-for-chatgpt/blob/main/SECURITY.md>.
- Public issue tracker: <https://github.com/chessyuan/google-photos-for-chatgpt/issues>.

Do not submit until both email placeholders and all `[OWNER-VERIFIED-DOMAIN]` placeholders are replaced with real, owner-controlled values.

## Official references

- [Chrome Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity)
- [Google Photos API authorization scopes](https://developers.google.com/photos/overview/authorization)
- [Manage app audience and publishing status](https://support.google.com/cloud/answer/15549945)
- [Submit an app for OAuth verification](https://support.google.com/cloud/answer/13461325)
- [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [OAuth production policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [OAuth for installed applications and Chrome extensions](https://developers.google.com/identity/protocols/oauth2/native-app)
