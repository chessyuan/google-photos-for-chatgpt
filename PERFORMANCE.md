# GPFC performance report

Date: 2026-08-15

This report separates measurements from models and from work that requires a user to select private Google Photos. No private media was selected automatically.

## Critical path found

The original completion loop always slept for the returned Picker polling interval before `sessions.get`. With a typical 2 s interval, `/autoclose` could therefore leave a user-visible 0–2 s scheduling gap after Done. The original download path was also serial, requested `baseUrl=d` for every format, and converted each 256 KB block from binary to base64 and back on ChatGPT's main thread. Attachment verification polled a boolean every 100 ms and could wait 2.5 s for each wrong ChatGPT file-input candidate.

The optimized path is:

    /autoclose tab close
    → one deduplicated immediate sessions.get
    → official poll interval only when mediaItemsSet is still false
    → single-flight mediaItems.list
    → unique media IDs
    → 3-way bounded original-media download queue
    → 256 KB compatibility chunks
    → one File construction in the content script
    → cached semantic file input
    → DataTransfer + input/change
    → event-driven preview mutation

Picker startup uses one minimized, unfocused popup as a real browsing-context preload. Google explicitly disallows loading `pickerUri` in an iframe, so a browser window/tab is required to eliminate the Google Photos document load from the click path. GPFC keeps that context out of the main tab strip, never recreates it immediately after an explicit user close, and restores it only after a click. As soon as a session is consumed, its replacement begins prewarming while the user is still selecting; earlier photo downloads no longer block a new Picker.

Google's returned `pollInterval` and `expireTime` remain authoritative. The fast path sends only one additional completion check and never spins. The implementation follows the official [Picker session lifecycle](https://developers.google.com/photos/picker/guides/sessions) and [media-item base URL parameters](https://developers.google.com/photos/picker/guides/media-items). A later stability correction reverted resized renditions and structured-clone Blob messaging after real ChatGPT uploads failed despite synthetic DOM acceptance; production now prioritizes byte/metadata consistency.

## Measured binary data-path experiment (disabled in production)

`npm run benchmark:data-path`, 15 samples per size on this machine. Times compare binary → base64 → binary → Blob/File work with a Blob structured-clone simulation. They do not include network transfer, Chrome's real extension-context serialization, or ChatGPT upload validation. The faster experimental path is therefore not enabled in the production extension.

| Payload | Path | Median | p75 | p95 | Min | Max |
|---|---:|---:|---:|---:|---:|---:|
| 1 MB | Before: base64 | 37.38 ms | 40.18 ms | 46.57 ms | 35.28 ms | 46.57 ms |
| 1 MB | After: Blob | 0.23 ms | 0.24 ms | 0.27 ms | 0.18 ms | 0.27 ms |
| 5 MB | Before: base64 | 184.63 ms | 188.12 ms | 198.60 ms | 180.84 ms | 198.60 ms |
| 5 MB | After: Blob | 0.65 ms | 0.73 ms | 1.17 ms | 0.47 ms | 1.17 ms |
| 12 MB | Before: base64 | 448.18 ms | 465.87 ms | 487.60 ms | 438.03 ms | 487.60 ms |
| 12 MB | After: Blob | 1.19 ms | 1.45 ms | 1.95 ms | 1.09 ms | 1.95 ms |

Median CPU-path reductions were 37.15 ms (99.4%), 183.98 ms (99.6%), and 446.98 ms (99.7%) respectively. Actual extension messaging also includes Chrome's Blob clone/copy and process scheduling; the debug T17–T18 markers measure that separately on the user's browser.

## Before and after: completion scheduling

For a 2 s official interval, the old unconditional first sleep creates a uniform scheduling wait with a modeled median of 1000 ms, p75 1500 ms, p95 1900 ms, min 0 ms, and max 2000 ms. This model matches the reported 1–2 s pause but is not presented as a private-photo network trace.

After the change, the tab/window close listener wakes the pending poll immediately. Regression tests prove immediate wake, duplicate-event suppression, one finalize task, and return to the full official interval after a false `mediaItemsSet` response. A live Done → `sessions.get` percentile needs one or more user-driven Picker selections; the extension's debug report now records T03–T08 for that measurement without exposing tokens or bytes.

## Real browser control and ChatGPT smoke

An isolated Chromium profile loaded the built extension and the real `https://chatgpt.com`. All images were synthetic 1×1 PNGs and were never sent as a chat message. Five repeats were run after the page's composer had settled. The timing is service-worker test command → content script → File preparation → cached target resolution → DataTransfer/input/change → first meaningful ChatGPT composer DOM mutation.

| Synthetic files | Median | p75 | p95 | Min | Max |
|---:|---:|---:|---:|---:|---:|
| 1 | 41.0 ms | 43.0 ms | 65.4 ms | 33.6 ms | 65.4 ms |
| 3 | 39.6 ms | 52.9 ms | 72.9 ms | 35.7 ms | 72.9 ms |
| 5 | 58.4 ms | 59.8 ms | 59.8 ms | 52.7 ms | 59.8 ms |

The local file-input control, measured from the native input/change event to the first composer DOM mutation with the same synthetic PNG, was median 5.4 ms, p75 8.5 ms, p95 8.6 ms, min 4.6 ms, max 8.6 ms. The difference includes GPFC's worker/content round trip, synthetic File creation, target lookup, DataTransfer construction, and event dispatch. Larger real images can make ChatGPT's own upload/render time much longer.

The same smoke run verified the fixed extension ID, configured OAuth client, exact Picker scope, stable JSON messaging, Phase 1 page load, exactly one 32 px icon-only button positioned outside the composer's left edge before and after ChatGPT reload, and successful 1/3/5-file DOM acceptance. Both desktop `upload-files` and mobile-composer input variants were encountered across runs; no hashed CSS class is used.

## Image dimension experiment (disabled in production)

The experiment used a 2560 px longest-edge boundary for JPEG/PNG/WEBP. A local 4032×3024 synthetic document/screenshot proxy was resized with high-quality filtering:

| Longest edge | Reconstructed PSNR | JPEG 90 | Optimized PNG |
|---:|---:|---:|---:|
| 1600 | 25.07 dB | 189.4 KB | 367.6 KB |
| 2048 | 26.66 dB | 287.2 KB | 538.3 KB |
| 2560 | 28.85 dB | 411.1 KB | 704.8 KB |

2560 retained about 2.2 dB more fine-detail fidelity than 2048 in this text-heavy proxy. This local fidelity result did not prove that Google's returned encoding would keep the original filename/MIME semantics. Production therefore uses `=d` for every image format.

## Final bottleneck classification

1. Google Photos API/network: third-party and variable; extension scheduling no longer adds a full polling interval after close.
2. Google image transfer: likely the largest variable segment for real photos; three-way bounded concurrency remains, while original bytes are retained for upload correctness.
3. Extension architecture: the measured File-ready synthetic route is typically about 40–58 ms for 1–5 files; production accepts the base64 CPU cost to keep the proven message protocol.
4. ChatGPT DOM/injection: semantic cache and event-driven observer are fast; bounded fallback remains for React replacement or an unavailable input.
5. ChatGPT internal upload/render: third-party and image-size dependent. The tiny local control was 5.4 ms median, but real images can be substantially slower.

## Performance budgets

- Completion close signal → immediate session request: no artificial wait; target under 20 ms excluding worker wake and network.
- Chunk reassembly → File conversion: measured per operation with T17–T18 in debug builds.
- Compatibility messaging uses 256 KB chunks so no single message contains the whole image.
- Cached ChatGPT target resolution and File injection: target under 10 ms each.
- File-ready → first meaningful ChatGPT DOM mutation: under 100 ms typical for 1–5 already-available files.
- Base64 work is bounded per chunk; correctness takes priority over the disabled Blob experiment.

## Honest end-to-end boundary

A production percentile for private-photo **Picker Done → ChatGPT preview visible** was not fabricated and was not automated, because doing so would require selecting the user's Google Photos. The debug build now emits the complete T00–T27 timeline for a user-driven selection. The measured controlled segments, official-flow regression tests, and real ChatGPT synthetic smoke are complete; the remaining live total is dominated by Google API/image transfer plus ChatGPT processing and must be captured from an explicit user selection.
