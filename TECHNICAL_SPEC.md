# ClipForge: TECHNICAL_SPEC.md (V6.5, native engine)

## 1. Principles
- ClipForge is an independent clipping platform. No third-party clipping provider, API key or backend is used or required.
- Static hosting only. All media processing (Whisper, FFmpeg.wasm) runs on the user’s device.
- Compliance by design: platform links are preview-only; clips come from creator-authorised media; rights gate before export/post.

## 2. Repository layout
| Path | Role |
|---|---|
| `index.html` | Dashboard UI + app script (ES module). Sidebar, all panels, orchestration of engines |
| `src/native/platforms.js` | Link classification (YouTube/Twitch/Vimeo/Kick/direct/HLS) and embed URLs |
| `src/native/video-input.js` | File/URL validation, format handling, limits |
| `src/native/hls.js` | HLS playlist parsing and authorised stream download (no encrypted streams) |
| `src/native/highlights.js` | Viral-moment scoring and clip selection |
| `src/native/captions.js` | Cue building, SRT, ASS (captions + hook overlay) |
| `src/native/export-settings.js` | Quality presets, output sizes, FFmpeg argument builder |
| `src/native/campaigns.js` | Multi-campaign store, brief parser, compliance checks |
| `src/native/publish.js` | YouTube resumable upload, share-sheet and manual-post helpers |
| `tests/` | Node test runner suites; `tests/helpers/fake-dom.js` boots the real page script against a strict DOM stand-in |
| `.github/workflows/test.yml` | CI: `npm test` on push/PR to `main` and `v6.5-native-engine` |

## 3. Pipeline
1. **Import** → `validateVideoFile` → `<video>` metadata; if undecodable or duration is not finite → FFmpeg preview proxy (MP4, ≤480p). Export always uses the original file.
2. **Analyse** → FFmpeg extracts 16 kHz mono WAV → per-second loudness (`energyPerSecond`) → Whisper (tiny/base, translate or transcribe) → `findViralMoments`.
3. **Score (0–100)**: hook, emotion, punchiness, pace, audio energy/peak, clean ending, opening-hook bonus. Windows are anchored on transcript segments; selection is greedy with a max-overlap rule and a minimum-score floor. Speech-free videos use loud-segment fallback only.
4. **Edit** → trim (validated against campaign duration), hook text, per-chunk caption editing.
5. **Export** → `buildExportArgs` (trim, scale/crop or pad, subtitles via libass with fonts dir, optional logo overlay, H.264 CRF/preset by quality, AAC). Exit codes are checked; failed caption rendering falls back to a clean export with a message.
6. **Post** → YouTube resumable upload (`youtube.upload` scope requested on demand) or share/manual helpers.

## 4. Quality presets
| Quality | 9:16 | 1:1 | 16:9 | CRF / preset |
|---|---|---|---|---|
| 480p | 480×854 | 480×480 | 854×480 | 26 / ultrafast |
| 720p | 720×1280 | 720×720 | 1280×720 | 24 / ultrafast |
| 1080p | 1080×1920 | 1080×1080 | 1920×1080 | 22 / veryfast |

## 5. Navigation contract
Every sidebar `<a class="cf-nav" href="#id">` targets a `<section id>`; links are unique and in page order; active state follows scroll (IntersectionObserver) and clicks. Campaign items are `<button data-campaign-id>` entries. One toggle (`#cfMenuToggle`) opens the off-canvas drawer below 850 px; backdrop, Escape and link clicks close it. Enforced by `tests/ui.test.js`.

## 6. Storage (browser only)
`clipforge.campaigns.v2` (v1 migrates), `clipforge.rights.v2`, `clipforge.settings.v1`, `clipforge.ytclient`. OAuth tokens are kept in memory only.

## 7. Known limitations
See README “Honest limits”. In-browser behaviour of FFmpeg.wasm, Whisper download, Google sign-in and YouTube upload is exercised by code review and unit tests with mocks; it needs a manual check on the deployed site.
