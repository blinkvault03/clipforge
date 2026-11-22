/**
 * OpusClip provider (OPTIONAL). Implements the ClipForge provider contract.
 * ClipForge does not depend on this provider: it is registered, never required.
 * Behaviour is identical to the V6.3 Worker (request body, headers, endpoints, status passthrough).
 */
import { PROVIDER_STATUS, ProviderError, ERROR_CODES } from "../core/contract.js";
import { JOB_STATUS, extractClipRows, normalizeClip } from "../core/models.js";

export const OPUS_API = "https://api.opus.pro/api";

/** ClipJob -> OpusClip request body. Key order matches V6.3 so the forwarded JSON is byte-identical. */
export function buildProjectRequest(job) {
  if (job.aspectRatio !== "portrait" && job.aspectRatio !== "landscape")
    throw new ProviderError(ERROR_CODES.UNSUPPORTED_JOB, `OpusClip adapter does not support the ${job.aspectRatio} aspect ratio.`, { httpStatus: 422 });
  if (job.source.type !== "url")
    throw new ProviderError(ERROR_CODES.UNSUPPORTED_JOB, `OpusClip adapter cannot process "${job.source.type}" sources.`, { httpStatus: 422 });
  return {
    videoUrl: job.source.url,
    curationPref: { clipDurations: job.durations, genre: job.genre, skipCurate: !job.curation.auto, customPrompt: job.prompt },
    importPref: { sourceLang: job.language },
    renderPref: { layoutAspectRatio: job.aspectRatio }
  };
}

const baseHeaders = env => ({ "Authorization": `Bearer ${env.OPUS_API_KEY}`, "Content-Type": "application/json" });
const doFetch = ctx => (ctx?.fetch || globalThis.fetch);

export const opusclip = {
  id: "opusclip",
  label: "OpusClip",
  cost: "paid",
  dataFlow: "third-party",
  requiresCredentials: true,
  configHint: "Add OPUS_API_KEY as a Worker secret.",
  // Describes what this ADAPTER implements, not everything OpusClip offers.
  capabilities: {
    sourceTypes: ["url"],
    aspectRatios: ["portrait", "landscape"],
    clipDuration: null,
    maxDurationRanges: 4,
    features: { customPrompt: true, genre: true, language: true, autoCuration: true },
    campaign: { durationRange: true, aspectRatio: true, captions: false, hooks: false, hashtags: false, overlays: false, prohibitedContent: false },
    export: { providerLinks: true, hdExport: false }
  },

  isConfigured: env => !!env?.OPUS_API_KEY,

  // "available" means configured; V6.3 never pinged the upstream, so neither does this.
  async health(env) {
    return this.isConfigured(env)
      ? { status: PROVIDER_STATUS.AVAILABLE, detail: "API key configured (upstream reachability not checked)." }
      : { status: PROVIDER_STATUS.UNCONFIGURED, detail: this.configHint };
  },

  async submit(job, env, ctx) {
    const body = buildProjectRequest(job);
    const up = await doFetch(ctx)(`${OPUS_API}/clip-projects`, { method: "POST", headers: baseHeaders(env), body: JSON.stringify(body) });
    const raw = await up.json().catch(() => ({}));
    const providerJobId = raw?.projectId || raw?.id || raw?.project?.id || null;
    return { ok: up.ok, httpStatus: up.status, providerJobId, raw };
  },

  async results(providerJobId, env, ctx) {
    const h = baseHeaders(env);
    if (env.OPUS_ORG_ID) h["x-opus-org-id"] = env.OPUS_ORG_ID;
    const up = await doFetch(ctx)(`${OPUS_API}/exportable-clips?q=findByProjectId&projectId=${encodeURIComponent(providerJobId)}`, { headers: h });
    const raw = await up.json().catch(() => ({}));
    if (!up.ok) return { ok: false, httpStatus: up.status, raw, status: null, clips: [], error: { code: ERROR_CODES.UPSTREAM_ERROR, message: raw?.error || raw?.message || `Provider request failed (${up.status})` } };
    const clips = extractClipRows(raw).map(normalizeClip);
    // V6.3 only exposed "exportable clips": none yet => assume still processing (inferred, not provider-reported).
    return { ok: true, httpStatus: up.status, raw, status: clips.length ? JOB_STATUS.COMPLETED : JOB_STATUS.PROCESSING, clips };
  }
};
