/**
 * Provider contract — every clipping provider (OpusClip, local engine, mock, future ones) implements this.
 *
 * Provider shape:
 *   id            lowercase slug, e.g. "opusclip"
 *   label         human name
 *   cost          "free" | "paid" | "local"          (used to forbid silent switches to costlier providers)
 *   dataFlow      "local" | "third-party"            (used to forbid silent switches with privacy impact)
 *   requiresCredentials  boolean
 *   configHint    optional string shown when not configured
 *   capabilities  what THIS ADAPTER implements (not necessarily everything the vendor offers):
 *     { sourceTypes[], aspectRatios[], clipDuration:null|{min,max}, maxDurationRanges,
 *       features:{customPrompt,genre,language,autoCuration},
 *       campaign:{durationRange,aspectRatio,captions,hooks,hashtags,overlays,prohibitedContent},
 *       export:{providerLinks,hdExport} }
 *   isConfigured(env) -> boolean
 *   health(env, ctx)  -> Promise<{status:"available"|"unconfigured"|"error", detail?}>     (AVAILABILITY)
 *   submit(job, env, ctx)           -> Promise<{ok, httpStatus, providerJobId, raw}>
 *   results(providerJobId, env, ctx)-> Promise<{ok, httpStatus, raw, status, clips[], error?}>
 * ctx = { fetch? }  (injectable for tests)
 *
 * Availability (health) and compatibility (checkJobCompatibility) are deliberately separate:
 * a provider can be available yet unable to process a particular job.
 */
export const PROVIDER_STATUS = Object.freeze({ AVAILABLE: "available", UNCONFIGURED: "unconfigured", ERROR: "error" });
export const COST_CLASSES = Object.freeze(["free", "paid", "local"]);
export const DATA_FLOWS = Object.freeze(["local", "third-party"]);
export const ERROR_CODES = Object.freeze({
  UNKNOWN_PROVIDER: "UNKNOWN_PROVIDER", NOT_CONFIGURED: "NOT_CONFIGURED", UNSUPPORTED_JOB: "UNSUPPORTED_JOB",
  UPSTREAM_ERROR: "UPSTREAM_ERROR", NETWORK_ERROR: "NETWORK_ERROR", INVALID_SOURCE_URL: "INVALID_SOURCE_URL"
});
const REQUIRED_METHODS = ["isConfigured", "health", "submit", "results"];

export class ProviderError extends Error {
  constructor(code, message, { retryable = false, httpStatus, cause } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    if (cause) this.cause = cause;
  }
}

export function assertProvider(p) {
  const problems = [];
  if (!p || typeof p !== "object") throw new TypeError("Provider must be an object");
  if (typeof p.id !== "string" || !/^[a-z0-9_-]+$/.test(p.id)) problems.push("id must match /^[a-z0-9_-]+$/");
  if (typeof p.label !== "string" || !p.label) problems.push("label is required");
  if (!COST_CLASSES.includes(p.cost)) problems.push(`cost must be one of ${COST_CLASSES.join("|")}`);
  if (!DATA_FLOWS.includes(p.dataFlow)) problems.push(`dataFlow must be one of ${DATA_FLOWS.join("|")}`);
  if (typeof p.requiresCredentials !== "boolean") problems.push("requiresCredentials must be boolean");
  const c = p.capabilities;
  if (!c || typeof c !== "object") problems.push("capabilities are required");
  else {
    if (!Array.isArray(c.sourceTypes)) problems.push("capabilities.sourceTypes must be an array");
    if (!Array.isArray(c.aspectRatios)) problems.push("capabilities.aspectRatios must be an array");
    if (!Number.isInteger(c.maxDurationRanges)) problems.push("capabilities.maxDurationRanges must be an integer");
    if (!c.features || typeof c.features !== "object") problems.push("capabilities.features is required");
    if (!c.campaign || typeof c.campaign !== "object") problems.push("capabilities.campaign is required");
  }
  for (const m of REQUIRED_METHODS) if (typeof p[m] !== "function") problems.push(`missing method ${m}()`);
  if (problems.length) throw new TypeError(`Invalid provider "${p?.id ?? "?"}": ${problems.join("; ")}`);
  return p;
}

const CAMPAIGN_RULES = [
  ["durationRange", c => !!c.durationRange, "duration range"],
  ["aspectRatio", c => !!c.aspectRatio, "aspect ratio"],
  ["captions", c => c.captions.required, "required captions"],
  ["hooks", c => c.hooks.length > 0, "hooks"],
  ["hashtags", c => c.hashtags.length > 0, "hashtags"],
  ["overlays", c => c.overlays.length > 0, "overlays"],
  ["prohibitedContent", c => c.prohibited.terms.length + c.prohibited.topics.length > 0, "prohibited-content rules"]
];

/**
 * Can this provider process this job? Returns every reason (not just the first).
 * severity "blocking" => cannot process; "warning" => can process but something will be ignored/unenforced.
 */
export function checkJobCompatibility(provider, job) {
  const c = provider.capabilities, reasons = [];
  const add = (code, message, severity = "blocking") => reasons.push({ code, message, severity });
  const name = provider.label;
  if (!c.sourceTypes.includes(job.source.type)) add("UNSUPPORTED_SOURCE_TYPE", `${name} cannot process "${job.source.type}" sources.`);
  if (!c.aspectRatios.includes(job.aspectRatio)) add("UNSUPPORTED_ASPECT_RATIO", `${name} does not support the ${job.aspectRatio} aspect ratio.`);
  if (job.durations.length > c.maxDurationRanges) add("TOO_MANY_DURATION_RANGES", `${name} accepts at most ${c.maxDurationRanges} duration ranges.`);
  if (c.clipDuration) {
    const bad = job.durations.some(([lo, hi]) => lo < c.clipDuration.min || hi > c.clipDuration.max);
    if (bad) add("DURATION_OUT_OF_RANGE", `${name} supports clips of ${c.clipDuration.min}–${c.clipDuration.max}s only.`);
  }
  if (job.prompt && !c.features.customPrompt) add("PROMPT_NOT_SUPPORTED", `${name} ignores custom prompts.`, "warning");
  if (job.genre && !c.features.genre) add("GENRE_NOT_SUPPORTED", `${name} ignores the genre setting.`, "warning");
  if (job.language !== "auto" && !c.features.language) add("LANGUAGE_NOT_SUPPORTED", `${name} ignores the source-language setting.`, "warning");
  if (job.campaign) {
    for (const [key, present, label] of CAMPAIGN_RULES)
      if (present(job.campaign) && !c.campaign[key])
        add(`CAMPAIGN_${key.replace(/[A-Z]/g, m => "_" + m).toUpperCase()}_NOT_ENFORCED`, `${name} cannot enforce the campaign's ${label}; verify the output before submitting.`, "warning");
  }
  return { providerId: provider.id, compatible: !reasons.some(r => r.severity === "blocking"), reasons };
}
