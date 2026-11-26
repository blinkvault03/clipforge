/**
 * Viral-moment detection (runs fully on-device, no API).
 *
 * Signals combined into a 0–100 "viral score":
 *   hook      strong opening line in the first seconds (question, bold claim, number, "wait", "no way" ...)
 *   emotion   superlatives, reactions, laughter, intensity words
 *   punch     exclamations / questions, short punchy sentences
 *   pace      words per second (dead air scores low)
 *   energy    loudness of the audio (peaks = shouting, laughing, hype moments)
 *   payoff    the clip ends on a finished sentence rather than mid-thought
 * Windows are anchored on transcript segments so clips start and end on natural boundaries.
 */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const HOOK_WORDS = /\b(wait|no way|listen|look|watch this|secret|mistake|never|always|nobody|everyone|crazy|insane|unbelievable|shocking|actually|here'?s the thing|the truth|guess what|imagine|you won'?t believe|i can'?t believe|how to|why|stop|don'?t)\b/i;
const EMOTION_WORDS = /\b(love|hate|best|worst|amazing|incredible|terrible|awesome|hilarious|funny|scary|insane|crazy|wow|omg|oh my god|holy|no way|what the|unreal|clutch|epic|legendary|disgusting|beautiful|dead|screaming|laughing|cry|crying|shocked|surprised)\b/i;
const LAUGH = /\b(ha(ha)+|lol|lmao|haha|hehe)\b/i;
const NUMBER_CLAIM = /\b(\d+(?:[.,]\d+)?\s?(?:%|percent|x|times|million|billion|thousand|k|dollars|\$|years?|days?|hours?|minutes?)|\$\s?\d+|top \d+|\d+ (?:ways|things|tips|reasons|steps|mistakes))\b/i;
const FILLER_ONLY = /^(um+|uh+|you know|like|so|and|okay|ok|yeah|mm+)[.!?,\s]*$/i;

const words = t => (String(t || "").toLowerCase().match(/[a-z0-9'$%]+/g) || []);

/** Score a block of text. Returns signals each 0..1 and the human-readable reasons that fired. */
export function scoreText(text, spanSeconds = 0) {
  const t = String(text || "").trim();
  const w = words(t);
  const reasons = [];
  if (!w.length || FILLER_ONLY.test(t)) return { hook: 0, emotion: 0, punch: 0, pace: 0, reasons };
  const hook = clamp((HOOK_WORDS.test(t) ? 0.6 : 0) + (/\?/.test(t.slice(0, 160)) ? 0.25 : 0) + (NUMBER_CLAIM.test(t) ? 0.25 : 0), 0, 1);
  const emoHits = (t.match(new RegExp(EMOTION_WORDS.source, "gi")) || []).length + (LAUGH.test(t) ? 2 : 0);
  const emotion = clamp(emoHits * 0.28, 0, 1);
  const punch = clamp(((t.match(/[!?]/g) || []).length) * 0.18, 0, 1);
  const wps = spanSeconds > 0 ? w.length / spanSeconds : 0;
  const pace = clamp(wps / 3, 0, 1);
  if (hook >= 0.55) reasons.push("strong hook");
  if (NUMBER_CLAIM.test(t)) reasons.push("specific number/claim");
  if (emotion >= 0.28) reasons.push("emotional reaction");
  if (LAUGH.test(t)) reasons.push("laughter");
  if (punch >= 0.36) reasons.push("punchy delivery");
  return { hook, emotion, punch, pace, reasons };
}

/**
 * Per-second loudness (0..1) from mono samples. Normalised against the 95th percentile
 * so one loud spike does not flatten everything else.
 */
export function energyPerSecond(samples, sampleRate) {
  if (!samples?.length || !(sampleRate > 0)) return [];
  const n = Math.ceil(samples.length / sampleRate);
  const rms = new Array(n).fill(0);
  for (let s = 0; s < n; s++) {
    const a = s * sampleRate, b = Math.min(samples.length, a + sampleRate);
    let sum = 0;
    for (let i = a; i < b; i++) sum += samples[i] * samples[i];
    rms[s] = b > a ? Math.sqrt(sum / (b - a)) : 0;
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const ref = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1] || 1;
  return rms.map(v => clamp(ref > 0 ? v / ref : 0, 0, 1));
}

const meanOf = (arr, a, b) => {
  const lo = Math.max(0, Math.floor(a)), hi = Math.min(arr.length, Math.ceil(b));
  if (hi <= lo) return 0;
  let s = 0;
  for (let i = lo; i < hi; i++) s += arr[i];
  return s / (hi - lo);
};

/**
 * Build ranked, non-overlapping clip candidates.
 * @param transcript [{text, timestamp:[start,end]}]
 * @param duration   total video seconds
 * @param opts       {minLen, maxLen, maxClips, energy (per-second array), maxOverlap}
 * @returns [{start,end,score(0..1),viral(0..100),reason,quote,signals,title?}] best first
 */
export function findViralMoments(transcript, duration, opts = {}) {
  const { minLen = 30, maxLen = 60, maxClips = 8, energy = [], maxOverlap = 0.25 } = opts;
  if (!(duration >= minLen) || minLen > maxLen) return [];
  const segs = (transcript || [])
    .filter(c => Array.isArray(c.timestamp) && Number.isFinite(c.timestamp[0]))
    .map((c, i, all) => {
      const start = clamp(c.timestamp[0], 0, duration);
      const next = all[i + 1]?.timestamp?.[0];
      const rawEnd = Number.isFinite(c.timestamp[1]) ? c.timestamp[1] : (Number.isFinite(next) ? next : start + 3);
      return { text: String(c.text || "").trim(), start, end: clamp(Math.max(rawEnd, start + 0.5), 0, duration) };
    })
    .filter(s => s.end > s.start);

  const proposals = [];
  const hasEnergy = energy.length > 0;
  const energyMean = hasEnergy ? meanOf(energy, 0, energy.length) : 0;

  const addWindow = (start, end, segsIn) => {
    const text = segsIn.map(s => s.text).join(" ");
    const span = Math.max(1, end - start);
    const head = segsIn.filter(s => s.start < start + 8).map(s => s.text).join(" ");
    const whole = scoreText(text, span);
    const opening = scoreText(head, Math.min(8, span));
    const eMean = hasEnergy ? meanOf(energy, start, end) : 0;
    const eRel = hasEnergy && energyMean > 0 ? clamp(eMean / (energyMean * 1.6), 0, 1) : 0;
    let ePeak = 0;
    if (hasEnergy) for (let s = Math.floor(start); s < Math.ceil(end); s++) ePeak = Math.max(ePeak, energy[s] || 0);
    const lastText = segsIn.length ? segsIn[segsIn.length - 1].text : "";
    const payoff = /[.!?]["')\]]?$/.test(lastText) ? 1 : 0;
    const reasons = [...new Set([...(opening.hook >= 0.55 ? ["strong opening hook"] : []), ...whole.reasons.filter(r => r !== "strong hook")])];
    if (eRel >= 0.55 || ePeak >= 0.95) reasons.push("high audio energy");
    if (payoff) reasons.push("clean ending");

    const weights = hasEnergy
      ? { hook: 0.24, emotion: 0.16, punch: 0.08, pace: 0.10, energy: 0.28, payoff: 0.06, opening: 0.08 }
      : { hook: 0.34, emotion: 0.22, punch: 0.12, pace: 0.14, energy: 0, payoff: 0.08, opening: 0.10 };
    const score = clamp(
      weights.hook * whole.hook + weights.emotion * whole.emotion + weights.punch * whole.punch + weights.pace * whole.pace +
      weights.energy * clamp(0.6 * eRel + 0.4 * ePeak, 0, 1) + weights.payoff * payoff + weights.opening * opening.hook, 0, 1);
    proposals.push({
      start, end, score, viral: Math.round(score * 100),
      reason: reasons.length ? reasons.join(" · ") : "steady, informative stretch",
      quote: text.slice(0, 220),
      signals: { hook: whole.hook, emotion: whole.emotion, punch: whole.punch, pace: whole.pace, energy: eRel, peak: ePeak, payoff }
    });
  };

  // Transcript-anchored windows: begin at each segment, grow to the last segment end inside [minLen,maxLen].
  for (let i = 0; i < segs.length; i++) {
    const start = Math.max(0, segs[i].start - 0.3);
    if (start + minLen > duration) break;
    let end = null;
    const inWin = [];
    for (let j = i; j < segs.length; j++) {
      if (segs[j].end - start > maxLen) break;
      inWin.push(segs[j]);
      if (segs[j].end - start >= minLen) end = segs[j].end;
    }
    if (end === null) end = Math.min(duration, start + minLen);
    end = Math.min(duration, Math.max(end + 0.3, start + minLen));
    if (end - start > maxLen) end = start + maxLen;
    addWindow(start, end, inWin.filter(s => s.start < end));
  }

  // Speech-free fallback: loudest stretches only (never invented without a real signal).
  if (!proposals.length && hasEnergy) {
    const len = clamp(Math.round((minLen + maxLen) / 2), minLen, maxLen);
    for (let s = 0; s + len <= duration; s += Math.max(5, Math.floor(len / 3))) addWindow(s, s + len, []);
    for (const p of proposals) p.reason = p.reason === "steady, informative stretch" ? "audio energy (no speech detected)" : p.reason;
    return pickTop(proposals.filter(p => p.signals.energy >= 0.5 || p.signals.peak >= 0.95), maxClips, maxOverlap);
  }
  return pickTop(proposals, maxClips, maxOverlap);
}

function overlapFraction(a, b) {
  const o = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return o <= 0 ? 0 : o / Math.min(a.end - a.start, b.end - b.start);
}

function pickTop(proposals, maxClips, maxOverlap) {
  const chosen = [];
  for (const p of [...proposals].sort((a, b) => b.score - a.score)) {
    if (p.score < 0.12) continue; // do not pad the list with weak moments
    if (chosen.every(c => overlapFraction(c, p) <= maxOverlap)) chosen.push(p);
    if (chosen.length >= maxClips) break;
  }
  return chosen;
}
