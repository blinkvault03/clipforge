# ClipForge — TECHNICAL_SPEC.md
Version: V6.4 (Phase 1 of 4 complete) · Updated: 2026-11-23

## 1. Principles (architect decisions)
- Provider-independent adapter layer is the central integration point. **OpusClip is optional**, never required; no dependence on its API access, plan or credits.
- Providers are selected by configuration, never hard-coded; more authorised providers can be added.
- Long-term goal: ClipForge's own clipping engine. Ingestion, highlight detection, clip generation, editing and export stay modular.
- Never silently switch to a provider with extra cost or privacy implications. Local engine must stay independent of OpusClip.
- Do not claim local clipping works until the full pipeline is tested.

## 2. Repo layout
| Path | Role |
|---|---|
| `index.html` | Frontend (unchanged in Phase 1): local Whisper/FFmpeg pipeline, YouTube, campaign, rights, URL-to-AI panel |
| `worker.js` | Worker entry. Legacy V6.2 routes → registry → provider |
| `src/core/models.js` | ClipJob, CampaignProfile, JobRecord, ClipResult, fingerprinting, validation |
| `src/core/contract.js` | Provider contract, `assertProvider`, `checkJobCompatibility`, `ProviderError` |
| `src/core/registry.js` | Provider registry (`register/get/list/resolve/defaultId`) |
| `src/core/security.js` | `validateSourceUrl` (SSRF layer 1) — **not yet wired in** |
| `src/providers/opusclip.js` | Optional OpusClip provider (behaviour identical to V6.3) |
| `src/providers/index.js` | `createDefaultRegistry()` — Phase 1: OpusClip only, default |
| `tests/*.test.js`, `tests/fixtures/legacy_v63.js` | 61 tests (`npm test`, Node built-in runner, zero dependencies) |

`src/core` has no platform dependencies (uses only `crypto.subtle`, `URL`, `TextEncoder`), so the same modules can later run in the browser for the `local` provider.

## 3. Provider contract
```
id, label, cost("free"|"paid"|"local"), dataFlow("local"|"third-party"), requiresCredentials, configHint?
capabilities { sourceTypes, aspectRatios, clipDuration|null, maxDurationRanges,
               features{customPrompt,genre,language,autoCuration},
               campaign{durationRange,aspectRatio,captions,hooks,hashtags,overlays,prohibitedContent},
               export{providerLinks,hdExport} }       // = what the ADAPTER implements
isConfigured(env) · health(env,ctx) · submit(job,env,ctx) · results(providerJobId,env,ctx)
```
- **Availability** = `health()` (`available|unconfigured|error`). **Compatibility** = `checkJobCompatibility(provider, job)` → `{compatible, reasons[{code,message,severity}]}`; `blocking` = cannot process, `warning` = will be ignored/unenforced (e.g. campaign hooks on OpusClip). These are separate on purpose.
- `cost` and `dataFlow` exist so Phase 2 fallback can refuse silent switches to costlier or less private providers.
- Adapters must refuse jobs they can't honour (`ProviderError UNSUPPORTED_JOB`, HTTP 422) rather than silently degrade.

## 4. Data models (schemaVersion 1)
- **ClipJob** `{source{type,url}, durations[[min,max]≤4], genre?, prompt?, language, aspectRatio(portrait|landscape|square), curation{auto}, campaign|null, idempotencyKey?}`
- **CampaignProfile** (provider-independent) `{id,name,platform,durationRange,aspectRatio,captions{required,style},hooks[],hashtags[],overlays[{type,text,position}],prohibited{terms,topics},requiredTerms[],submission{requirements,deadline,url},license{basis,evidenceUrl,monetizationAllowed,allowedPlatforms,verified}}`
- **JobRecord** `{id, job, provider{id,jobId}, providerHistory[], status, attempts, checkpoints[{name,at,data?}], error{code,message,retryable}|null, createdAt, updatedAt}`; immutable updates; legal transitions: pending→submitting→processing→completed; failed→pending (retry); submitting→pending (rollback); cancel from non-terminal. `switchProvider()` keeps all job data and logs the old provider.
- **Duplicate guard:** `computeJobFingerprint(job, providerId)` (SHA-256 of normalised URL + options + provider).
- **ClipResult** `{id,title,previewUrl,downloadUrl,startSec,endSec,durationSec,score}`.
- Legacy V6.2 bodies map via `legacyToClipJob()`. A golden test proves the OpusClip request body is byte-identical to V6.3's.

## 5. HTTP API (Worker)
Unchanged: `GET /api/health`, `POST /api/clip-projects`, `GET /api/exportable-clips?projectId=`. Raw upstream payloads and statuses pass through. Unconfigured → 503 on every non-health route (as in V6.2). CORS locked via `ALLOWED_ORIGINS`.
Planned (Phase 2): `GET /api/providers`, `POST /api/jobs`, `GET /api/jobs/:id`.

## 6. Security status
- Credentials server-side only ✅ · CORS allowlist ✅ · request-body whitelist ✅
- `validateSourceUrl` implemented + tested (HTTPS only, no credentials/ports/IP literals incl. decimal/hex/octal/IPv6, no internal names, optional allow/block lists) but **NOT enforced on routes yet** (would change V6.2 behaviour; wired in Phase 2).
- Limitation: URL-text checks cannot see DNS resolution. Today the Worker never fetches user URLs (the provider does). Any ClipForge-side fetcher (local engine ingestion) must also block private/loopback/link-local addresses at connection time.
- Rights/licence gating remains a UI gate (not legal verification).

## 7. Roadmap
1. ✅ **Phase 1** — contract, models, registry, OpusClip behind contract, tests.
2. Phase 2 — config-based selection (`DEFAULT_PROVIDER`/`ENABLED_PROVIDERS`), `/api/providers`, `/api/jobs`, capability reasons in API, fallback rules (cost/privacy consent), job persistence + checkpoints + idempotent retry, wire SSRF validation, `mock` provider, graceful-degradation UI.
3. Phase 3 — split `index.html` pipeline into modules (ingestion, highlight detection, generation, editing, export).
4. Phase 4 — wrap local Whisper/FFmpeg pipeline as `local` provider; full pipeline testing before any "works" claim.

## 8. Known limitations
- OpusClip integration still unverified against a live account; field names assumed.
- OpusClip adapter derives "processing/completed" from whether clips exist (V6.2 had no status endpoint).
- Capability flags for OpusClip describe the adapter, not the vendor's full API.
- No persistence, provider selection, fallback or new routes yet (Phase 2).
