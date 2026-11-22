/**
 * ClipForge core data models — provider-independent and dependency-free.
 * Runs unchanged in Cloudflare Workers, browsers and Node.
 *
 *  ClipJob       what the user wants (a REQUEST; provider-neutral)
 *  CampaignProfile  optional rules attached to a ClipJob (provider-neutral)
 *  JobRecord     persisted STATE of a job (status, checkpoints, errors, provider)
 *  ClipResult    one normalised output clip
 */
export const SCHEMA_VERSION = 1;
export const JOB_STATUS = Object.freeze({
  PENDING: "pending", SUBMITTING: "submitting", PROCESSING: "processing",
  COMPLETED: "completed", FAILED: "failed", CANCELLED: "cancelled"
});
export const ASPECT_RATIOS = Object.freeze(["portrait", "landscape", "square"]);
export const SOURCE_TYPES = Object.freeze(["url", "file"]);
export const OVERLAY_TYPES = Object.freeze(["text", "logo", "watermark"]);
export const CHECKPOINTS = Object.freeze({
  CREATED: "created", SUBMIT_STARTED: "submit_started", SUBMIT_ACCEPTED: "submit_accepted",
  RESULTS_FETCHED: "results_fetched", COMPLETED: "completed"
});

/* ---------- small coercion helpers ---------- */
// NOTE: `num` deliberately keeps the exact V6.3 semantics (see tests/fixtures/legacy_v63.js).
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const optNum = v => (v == null || v === "" ? null : (Number.isFinite(Number(v)) ? Number(v) : null));
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);
const strList = (v, maxItems = 50, maxLen = 200) =>
  Array.isArray(v) ? v.filter(x => typeof x === "string").map(x => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : [];
const isoOrNull = v => { const t = typeof v === "string" ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/* ---------- CampaignProfile ---------- */
export function createCampaignProfile(raw = {}) {
  const r = raw || {};
  const min = optNum(r.durationRange?.min), max = optNum(r.durationRange?.max);
  return {
    id: str(r.id, 64) ?? null,
    name: str(r.name, 120) ?? "",
    platform: str(r.platform, 40)?.toLowerCase() ?? null,
    durationRange: min != null || max != null ? { min, max } : null,
    aspectRatio: ASPECT_RATIOS.includes(r.aspectRatio) ? r.aspectRatio : null,
    captions: { required: !!r.captions?.required, style: str(r.captions?.style, 60) },
    hooks: strList(r.hooks),
    hashtags: strList(r.hashtags, 30, 60).map(t => t.replace(/^#+/, "").replace(/\s+/g, "")).filter(Boolean).map(t => "#" + t),
    overlays: Array.isArray(r.overlays)
      ? r.overlays.slice(0, 10).map(o => ({ type: OVERLAY_TYPES.includes(o?.type) ? o.type : "text", text: str(o?.text, 200), position: str(o?.position, 30) }))
      : [],
    prohibited: { terms: strList(r.prohibited?.terms), topics: strList(r.prohibited?.topics) },
    requiredTerms: strList(r.requiredTerms),
    submission: { requirements: strList(r.submission?.requirements, 50, 300), deadline: isoOrNull(r.submission?.deadline), url: str(r.submission?.url, 2048) },
    license: {
      basis: str(r.license?.basis, 60), evidenceUrl: str(r.license?.evidenceUrl, 2048),
      monetizationAllowed: typeof r.license?.monetizationAllowed === "boolean" ? r.license.monetizationAllowed : null,
      allowedPlatforms: strList(r.license?.allowedPlatforms, 20, 40).map(s => s.toLowerCase()),
      verified: !!r.license?.verified
    }
  };
}

/* ---------- ClipJob ---------- */
export function createClipJob(input = {}) {
  const i = input || {};
  const src = i.source || {};
  const durs = Array.isArray(i.durations) ? i.durations.slice(0, 4) : [[30, 60]];
  return {
    schemaVersion: SCHEMA_VERSION,
    source: { type: SOURCE_TYPES.includes(src.type) ? src.type : "url", url: src.url == null ? "" : String(src.url) },
    durations: durs.map(p => [num(p?.[0], 30), num(p?.[1], 60)]),
    genre: str(i.genre, 60),
    prompt: str(i.prompt, 500),
    language: str(i.language, 12) ?? "auto",
    aspectRatio: ASPECT_RATIOS.includes(i.aspectRatio) ? i.aspectRatio : "portrait",
    curation: { auto: i.curation?.auto !== false },
    campaign: i.campaign ? createCampaignProfile(i.campaign) : null,
    idempotencyKey: str(i.idempotencyKey, 128)
  };
}

/** Map a V6.2/V6.3 client body ({videoUrl, curationPref, importPref, renderPref}) to a ClipJob. */
export function legacyToClipJob(body) {
  const b = body || {};
  const cur = b.curationPref || {};
  return createClipJob({
    source: { type: "url", url: String(b.videoUrl) },
    durations: Array.isArray(cur.clipDurations) ? cur.clipDurations : undefined,
    genre: cur.genre,
    prompt: cur.customPrompt,
    language: b.importPref?.sourceLang,
    aspectRatio: b.renderPref?.layoutAspectRatio === "landscape" ? "landscape" : "portrait",
    curation: { auto: !cur.skipCurate }
  });
}

/** Structural validation (does not touch the network). Deep URL safety lives in security.js. */
export function validateClipJob(job) {
  const issues = [];
  const add = (code, message) => issues.push({ code, message });
  if (!job?.source?.url) add("SOURCE_URL_REQUIRED", "A source URL is required.");
  else if (job.source.type === "url" && !/^https:\/\//i.test(job.source.url)) add("SOURCE_URL_NOT_HTTPS", "Source URL must use HTTPS.");
  if (!Array.isArray(job?.durations) || !job.durations.length) add("DURATIONS_REQUIRED", "At least one clip duration range is required.");
  else for (const [lo, hi] of job.durations) if (!(lo > 0) || !(hi >= lo)) { add("DURATION_INVALID", `Invalid duration range ${lo}–${hi}s.`); break; }
  const c = job?.campaign;
  if (c?.durationRange) {
    const { min, max } = c.durationRange;
    const bad = (job.durations || []).some(([lo, hi]) => (min != null && lo < min) || (max != null && hi > max));
    if (bad) add("CAMPAIGN_DURATION_CONFLICT", `Job durations fall outside the campaign range (${min ?? "–"}–${max ?? "–"}s).`);
  }
  if (c?.aspectRatio && c.aspectRatio !== job.aspectRatio) add("CAMPAIGN_ASPECT_CONFLICT", `Campaign requires ${c.aspectRatio}, job requests ${job.aspectRatio}.`);
  return { ok: issues.length === 0, issues };
}

/** Deterministic duplicate-detection fingerprint (async SHA-256 hex). Same job + same provider ⇒ same value. */
export async function computeJobFingerprint(job, providerId) {
  let url = job.source.url;
  try { const u = new URL(url); url = u.origin + u.pathname + u.search; } catch { /* keep raw */ }
  const canon = JSON.stringify([url, job.durations, job.genre ?? null, job.prompt ?? null, job.language, job.aspectRatio, job.curation.auto, job.campaign?.id ?? null, providerId]);
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canon));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- JobRecord (persisted state; immutable updates) ---------- */
const TRANSITIONS = {
  pending: ["submitting", "cancelled", "failed"],
  submitting: ["processing", "failed", "pending", "cancelled"],
  processing: ["completed", "failed", "cancelled"],
  failed: ["pending"],
  completed: [],
  cancelled: []
};
const nowIso = () => new Date().toISOString();

export function createJobRecord({ job, providerId, id, now } = {}) {
  const t = now || nowIso();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id || globalThis.crypto.randomUUID(),
    job,
    provider: { id: providerId, jobId: null },
    providerHistory: [],
    status: JOB_STATUS.PENDING,
    attempts: 0,
    createdAt: t, updatedAt: t,
    checkpoints: [{ name: CHECKPOINTS.CREATED, at: t }],
    error: null
  };
}
export function transitionJob(record, status, now) {
  if (!(TRANSITIONS[record.status] || []).includes(status)) throw new Error(`Illegal job transition ${record.status} → ${status}`);
  return { ...record, status, updatedAt: now || nowIso(), attempts: status === JOB_STATUS.SUBMITTING ? record.attempts + 1 : record.attempts };
}
export function addCheckpoint(record, name, data, now) {
  const t = now || nowIso();
  return { ...record, updatedAt: t, checkpoints: [...record.checkpoints, data === undefined ? { name, at: t } : { name, at: t, data }] };
}
export function failJob(record, error, now) {
  const e = { code: error?.code || "UNKNOWN", message: String(error?.message || error || "Unknown error"), retryable: !!error?.retryable };
  return { ...transitionJob(record, JOB_STATUS.FAILED, now), error: e };
}
/** Move a job to another provider while keeping all job info; the old provider is kept in history. */
export function switchProvider(record, newProviderId, now) {
  return { ...record, updatedAt: now || nowIso(), providerHistory: [...record.providerHistory, { ...record.provider, switchedAt: now || nowIso() }], provider: { id: newProviderId, jobId: null } };
}

/* ---------- ClipResult ---------- */
export function extractClipRows(raw) {
  if (Array.isArray(raw)) return raw;
  for (const k of ["clips", "items", "data"]) if (Array.isArray(raw?.[k])) return raw[k];
  return [];
}
export function normalizeClip(c, i = 0) {
  const r = c || {};
  const start = optNum(r.startTime ?? r.start ?? r.startSec);
  const end = optNum(r.endTime ?? r.end ?? r.endSec);
  return {
    id: r.id ?? r.clipId ?? null,
    title: r.title || r.name || `Clip ${i + 1}`,
    previewUrl: r.previewUrl || r.preview_url || r.url || null,
    downloadUrl: r.downloadUrl || r.download_url || null,
    startSec: start, endSec: end,
    durationSec: start != null && end != null ? end - start : null,
    score: optNum(r.score)
  };
}
