# ClipForge V6.4 (Phase 1) — URL-to-AI clipping integration

## V6.4 / Phase 1: provider architecture
The Worker is no longer an OpusClip-only proxy. It is a provider-independent layer (`src/core/`) with OpusClip as an **optional** provider (`src/providers/opusclip.js`). ClipForge does not depend on OpusClip: the local Whisper/FFmpeg workflow never calls the Worker. Existing V6.2 routes and responses are unchanged. The frontend (`index.html`) is unchanged in this phase.

**Run the tests (Node 20+):** `npm test`

## What the V6.2 build added
- A dedicated URL-to-AI clipping panel in the ClipForge page.
- A Cloudflare Worker adapter that keeps the OpusClip API key server-side.
- Project submission and clip-result retrieval through the provider API.
- The existing local-file Whisper/FFmpeg workflow remains available.

## Important limitations
- GitHub Pages hosts only the static frontend. It cannot run `worker.js`.
- The Worker must be deployed separately (Cloudflare Workers).
- You need an OpusClip API key. Official documentation says API access is on Pro (Beta), Max and Business plans; API projects have a 10-credit minimum. This is not a free ClipForge backend.
- Do not paste the API key into `index.html`, GitHub, or chat.
- The provider returns clip results; this initial adapter does not yet implement the provider's separate HD export endpoint. Use provider download/export links for final MP4s.
- A public YouTube URL accepted by the provider is not proof that the user has permission to republish it. Keep the rights check and verify campaign terms.
- YouTube preview is separate from video ingestion. Do not use unofficial downloaders or bypass DRM/access controls.

## Deploy the frontend
1. Upload `index.html` to the root of your existing public GitHub repository (replace the old file).
2. Commit changes. GitHub Pages will redeploy.

## Deploy the API Worker
1. Create a Cloudflare account and install Wrangler on a computer with Node.js.
2. In this folder run `npm create cloudflare@latest` or use the Wrangler CLI to initialise a Worker project, then place `worker.js`, `wrangler.toml` and the whole `src/` folder in it (the Worker now imports from `src/`; deploying `worker.js` alone will fail).
3. Run `npx wrangler secret put OPUS_API_KEY` and paste your OpusClip API key into the terminal prompt.
4. If the account's API requires an organisation ID for clip retrieval, set `OPUS_ORG_ID` with `npx wrangler secret put OPUS_ORG_ID`.
5. Deploy with `npx wrangler deploy`.
6. Lock the Worker to your site: in `wrangler.toml` uncomment `[vars]` and set `ALLOWED_ORIGINS` to your GitHub Pages origin (e.g. `https://YOURNAME.github.io`), then redeploy. Without this, anyone who finds the Worker URL can spend your OpusClip credits.
7. Open ClipForge, paste `https://YOUR-WORKER.workers.dev/api` into the **backend address** box in the URL-to-AI panel and tap Save. It is stored in that browser (localStorage); no code edit is needed.

## Test
- Open `https://YOUR-WORKER.workers.dev/api/health`; it should return `{"ok":true,"provider":"opusclip","configured":true,"corsLocked":true}`. `corsLocked:false` means step 6 is not done yet.
- In ClipForge paste a supported, rights-cleared URL, tick the rights confirmation and submit.
- After processing, tap Refresh results.

## Current state
This is an integration scaffold, not a verified live connection. It has not been tested against a real OpusClip account because no API key or plan credentials were supplied. The official API reference is https://help.opus.pro/api-reference/overview and https://help.opus.pro/api-reference/quickstart.
