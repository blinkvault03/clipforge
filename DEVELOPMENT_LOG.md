# ClipForge — DEVELOPMENT_LOG.md

## 2026-11-23 — Session 1 (Lead Developer onboarding, V6.2 → V6.3)
**Inspected:** `clipforge_v6_2_url_to_ai_bundle.zip` (4 files). Ran `node --check` on worker and the extracted module script.

**Findings**
1. 🔴 `worker.js` line 27 had a double-escaped regex (`/^https:\\/\\//i`) → SyntaxError; Worker would not deploy. 
2. 🟠 Worker CORS was hard-coded `*` and forwarded the raw client body upstream → anyone with the URL could spend OpusClip credits and set arbitrary provider fields.
3. 🟡 `index.html` line 195 compared against `' /api'` (stray space) — dead/buggy line (line 196 already handled it).
4. 🟡 README said to edit a `CF_API_BASE` constant, but it is a runtime localStorage setting with a UI box; default `/api` fails on GitHub Pages.
5. ℹ️ Provider endpoints/payloads untested against a real account.

**Changes**
- `worker.js`: fixed regex; added `ALLOWED_ORIGINS` CORS lock (+ `Vary: Origin`); added `sanitizeProject()` field whitelist and length caps; `corsLocked` flag in `/health`; JSON-parse failures now return 400 not 502.
- `index.html`: removed buggy line 195. No other frontend changes.
- `wrangler.toml`: documented `ALLOWED_ORIGINS`.
- `README.md`: bumped to V6.3, corrected backend-address steps, added CORS lock step.
- Added TECHNICAL_SPEC.md, DEVELOPMENT_LOG.md, HANDOFF.md.

**Verification**
- Syntax OK: worker.js, index.html module script (node --check).
- Worker behaviour tested with stubbed upstream `fetch`: health, non-HTTPS rejection (400), whitelist strips unknown fields, CORS origin handling, clips URL construction, 404.
- NOT tested: browser UI, Whisper/FFmpeg pipeline at runtime, YouTube OAuth, live OpusClip calls.

## 2026-11-23 — Session 1, Phase 1 (V6.3 → V6.4): provider contract + data model
**Approved by:** ChatGPT (Lead Architect), with 5 extra requirements (fallback, campaign-aware jobs, persistence, capability selection, security) to be delivered across Phases 1–4.

**Added**
- `src/core/models.js` — ClipJob, CampaignProfile, JobRecord (+transitions, checkpoints, failJob, switchProvider), fingerprinting, ClipResult normalisation, validation.
- `src/core/contract.js` — provider contract, `assertProvider`, `checkJobCompatibility` (availability ≠ compatibility; blocking vs warning reasons), `ProviderError`.
- `src/core/registry.js`, `src/core/security.js` (`validateSourceUrl`), `src/providers/opusclip.js`, `src/providers/index.js`.
- `package.json` (`npm test`), `tests/` (61 tests).

**Changed**
- `worker.js` now routes the three legacy endpoints through the registry/provider. Responses, statuses, headers and upstream calls unchanged.
- `README.md`: V6.4 section; deploy now requires the `src/` folder.
- Only intentional behaviour difference: JSON body `null`/array to `/api/clip-projects` now returns 400 (previously crashed into a 502 with a TypeError message).

**Not changed:** `index.html` (frontend untouched).

**Tests (61 pass, 0 fail, Node 22)**
- Golden: 12 request bodies → new ClipJob path produces byte-identical JSON to a verbatim copy of V6.3 `sanitizeProject`.
- Contract/registry/compatibility, data models (campaign, job lifecycle, illegal transitions, provider switching, fingerprint), OpusClip provider (headers, status passthrough, non-JSON body, network failure, result normalisation), Worker end-to-end with stubbed fetch (503 parity, 400s, 402 passthrough, 502, CORS), SSRF validator (IP-literal variants, internal names, credentials, ports, allow/block lists).
- Mutation checks: deliberately broke 6 behaviours (inverted skipCurate, key order, IP-literal rule, 503 guard, compatibility verdict, transition guard); the suite failed each time. (One first attempt at the key-order mutation was a no-op; redone correctly.)

**Not tested:** browser UI, live OpusClip, Wrangler deploy of the multi-file Worker, local Whisper/FFmpeg pipeline.
