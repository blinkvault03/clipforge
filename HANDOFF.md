# ClipForge — HANDOFF.md (Claude → ChatGPT)
Date: 2026-11-23 · Version: V6.4 · **Phase 1 of 4 complete — awaiting approval to start Phase 2**

## Summary
OpusClip is now an optional provider behind a provider-independent contract. Legacy V6.2 API behaviour is preserved and proven by a golden test. Data models for campaigns, job persistence, fallback and capability checks are defined and tested but not yet used by routes or the UI.

## Files
New: `src/core/{models,contract,registry,security}.js`, `src/providers/{opusclip,index}.js`, `tests/*` (5 test files + 2 helpers/fixtures), `package.json`
Modified: `worker.js`, `README.md`, `TECHNICAL_SPEC.md`, `DEVELOPMENT_LOG.md`
Unchanged: `index.html`, `wrangler.toml`

## Tests
61/61 pass (`npm test`). Golden equivalence vs V6.3, contract, models, provider failures, Worker e2e, SSRF validator. Mutation-checked.

## Known bugs / risks
1. Multi-file Worker not yet deployed with Wrangler; README now says to ship `src/` too. Verify on first deploy.
2. `validateSourceUrl` is not enforced on any route yet (deliberate: Phase 1 = no behaviour change). Wire in Phase 2.
3. OpusClip live behaviour unverified; "processing/completed" is inferred from clip presence.
4. No persistence, provider selection, fallback or `/api/jobs` yet — models only.
5. Frontend still OpusClip-shaped (reads raw payload); Phase 2 migrates it to normalised results with legacy routes kept as aliases.
6. SSRF check is text-only; local-engine ingestion will need connection-time IP blocking.

## Remaining work
Phase 2: config-based selection + `/api/providers`, `/api/jobs` (normalised), capability reasons surfaced, fallback with explicit consent for cost/privacy changes, job persistence + checkpoints + idempotent retry, wire SSRF validation, `mock` provider, UI degradation. Then Phase 3 (modularise pipeline) and Phase 4 (`local` provider; full-pipeline testing before any claim).

## Questions for ChatGPT
1. Persistence location: browser localStorage/IndexedDB only (works offline, per-device) vs Worker KV/D1 (cross-device, needs Cloudflare setup)? My default: IndexedDB in the browser first, behind a storage interface so KV/D1 can be added.
2. Source allowlist: restrict to known platforms (YouTube/Vimeo/…) by default, or allow any public HTTPS host?
