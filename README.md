# ClipForge V6.5: native clipping studio

ClipForge is a **static, local-first** web app. It turns long videos and stream recordings into short, captioned, campaign-compliant clips. Everything runs in the browser (Whisper speech recognition and FFmpeg.wasm). There is no server, no account, no clipping API and no API key.

## What it does
- **Import:** upload any common video type (MP4, MOV, WebM, MKV, AVI, FLV, WMV, TS, 3GP, MPG…); drag and drop; direct media URLs; HLS (`.m3u8`) streams and live windows; record an authorised live stream by capturing a browser tab. Formats browsers cannot play get an automatic preview copy.
- **Link previews:** YouTube, Twitch, Vimeo (embedded player) and Kick (link only). Platform pages are **preview only**. ClipForge never scrapes or downloads protected media. To clip a platform video, use the creator’s recording.
- **AI analysis:** on-device Whisper transcription (English translation or original language), then viral-moment ranking from hook strength, emotion, pacing, audio energy and clean endings.
- **Review, trim and caption:** score-ranked clips, trim editor, hook/title overlay, editable captions, caption size/position/case.
- **Campaigns:** unlimited campaigns, each listed in the sidebar. Brief analysis, required/prohibited terms, hashtags, duration rule, platform, logo overlay and a per-clip compliance check.
- **Export:** 480p, 720p or 1080p H.264/AAC MP4 in 9:16, 1:1 or 16:9, with captions burned in (optional `.srt`), single clip or ZIP of all compliant clips.
- **Post:** direct YouTube upload (Shorts-ready) using your own Google OAuth Client ID; phone share sheet; download-and-open helpers for TikTok, Instagram and X.

## Honest limits
- TikTok, Instagram and X do not allow posting from a static site. Only YouTube is a true direct upload. A Google project that has not passed API verification uploads as **private**.
- Browsers cannot read YouTube/Twitch/Kick video bytes. Those links are previews.
- Live capture records what plays in a tab. Protected (DRM) streams record as black, and ClipForge does not circumvent protection.
- Files above ~2 GB cannot be held by the in-browser FFmpeg. Speed depends on device memory; 1080p is slowest.
- Caption burn-in needs a font file that the page downloads from a CDN at export time. If that fails, clips export without burned-in captions and the status message says so (use “Also download .srt”).
- Rights checks are a workflow gate, not legal advice.

## Run it
It must be served over HTTP(S). Opening `index.html` from disk will not load the modules.
```
npx serve .          # or: python3 -m http.server 8080
```
## Deploy (GitHub Pages)
Publish the repository root (`index.html` plus the `src/` folder) with Pages: **Settings → Pages → Deploy from a branch → `main` / root**. Both `index.html` and `src/native/*.js` must be deployed.

## YouTube connection and direct upload (optional)
1. Google Cloud Console → enable **YouTube Data API v3**.
2. Create an **OAuth client ID (Web application)** and add your site’s exact origin (for example `https://YOURNAME.github.io`) to authorised JavaScript origins.
3. Paste the Client ID in **Connected channels**. Read-only access is requested to list your videos and broadcasts. The upload permission is requested only when you press **Upload to YouTube**.

## Tests
`npm test` (Node 20+; FFmpeg on the PATH enables the real export tests, otherwise they are skipped). CI runs on pushes and pull requests to `main` and `v6.5-native-engine`.
