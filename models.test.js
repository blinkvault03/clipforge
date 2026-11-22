import test from "node:test";
import assert from "node:assert/strict";
import {
  createClipJob, createCampaignProfile, legacyToClipJob, validateClipJob, computeJobFingerprint,
  createJobRecord, transitionJob, addCheckpoint, failJob, switchProvider, JOB_STATUS, CHECKPOINTS,
  extractClipRows, normalizeClip
} from "../src/core/models.js";

test("createClipJob applies safe defaults", () => {
  const j = createClipJob({ source: { url: "https://youtu.be/abc" } });
  assert.equal(j.source.type, "url");
  assert.deepEqual(j.durations, [[30, 60]]);
  assert.equal(j.aspectRatio, "portrait");
  assert.equal(j.language, "auto");
  assert.deepEqual(j.curation, { auto: true });
  assert.equal(j.campaign, null);
});
test("createClipJob caps ranges/strings and rejects unknown enums", () => {
  const j = createClipJob({ source: { url: "https://a.com/x" }, durations: [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]], genre: "g".repeat(99), prompt: "p".repeat(900), aspectRatio: "diagonal", language: "x".repeat(40) });
  assert.equal(j.durations.length, 4);
  assert.equal(j.genre.length, 60);
  assert.equal(j.prompt.length, 500);
  assert.equal(j.language.length, 12);
  assert.equal(j.aspectRatio, "portrait");
});
test("createClipJob accepts square for new clients; legacy mapping never produces it", () => {
  assert.equal(createClipJob({ aspectRatio: "square" }).aspectRatio, "square");
  assert.equal(legacyToClipJob({ videoUrl: "https://a.com/x", renderPref: { layoutAspectRatio: "square" } }).aspectRatio, "portrait");
  assert.equal(legacyToClipJob({ videoUrl: "https://a.com/x", renderPref: { layoutAspectRatio: "landscape" } }).aspectRatio, "landscape");
});
test("legacyToClipJob maps skipCurate and tolerates junk bodies", () => {
  assert.equal(legacyToClipJob({ videoUrl: "https://a.com/x", curationPref: { skipCurate: true } }).curation.auto, false);
  assert.doesNotThrow(() => legacyToClipJob(null));
  assert.doesNotThrow(() => legacyToClipJob({ videoUrl: "https://a.com/x", curationPref: "oops", importPref: 5 }));
});
test("CampaignProfile normalises and is provider-independent", () => {
  const c = createCampaignProfile({
    id: "c1", name: "Summer", platform: "TikTok", durationRange: { min: "15", max: 45 }, aspectRatio: "portrait",
    captions: { required: 1, style: "bold" }, hooks: ["  Wait for it ", 5, ""], hashtags: ["#fun", "two words", "##x", " "],
    overlays: [{ type: "logo", position: "top-right" }, { type: "weird", text: "hi" }],
    prohibited: { terms: ["gambling"], topics: ["politics"] }, requiredTerms: ["#ad"],
    submission: { requirements: ["Link in bio"], deadline: "2026-12-31", url: "https://example.com/submit" },
    license: { basis: "own", monetizationAllowed: false, allowedPlatforms: ["TikTok"], verified: true }
  });
  assert.equal(c.platform, "tiktok");
  assert.deepEqual(c.durationRange, { min: 15, max: 45 });
  assert.deepEqual(c.hooks, ["Wait for it"]);
  assert.deepEqual(c.hashtags, ["#fun", "#twowords", "#x"]);
  assert.equal(c.overlays[1].type, "text");
  assert.equal(c.captions.required, true);
  assert.match(c.submission.deadline, /^2026-12-31T/);
  assert.equal(c.license.monetizationAllowed, false);
  assert.deepEqual(c.license.allowedPlatforms, ["tiktok"]);
});
test("empty/garbage campaign input yields a safe empty profile", () => {
  const c = createCampaignProfile(null);
  assert.equal(c.durationRange, null);
  assert.deepEqual(c.hooks, []);
  assert.equal(c.license.monetizationAllowed, null);
  assert.equal(c.submission.deadline, null);
});
test("validateClipJob reports structural and campaign conflicts", () => {
  const ok = createClipJob({ source: { url: "https://a.com/x" } });
  assert.equal(validateClipJob(ok).ok, true);
  assert.deepEqual(validateClipJob(createClipJob({})).issues.map(i => i.code), ["SOURCE_URL_REQUIRED"]);
  assert.equal(validateClipJob(createClipJob({ source: { url: "http://a.com" } })).issues[0].code, "SOURCE_URL_NOT_HTTPS");
  assert.equal(validateClipJob(createClipJob({ source: { url: "https://a.com" }, durations: [[60, 30]] })).issues[0].code, "DURATION_INVALID");
  const conflict = createClipJob({ source: { url: "https://a.com" }, durations: [[30, 90]], aspectRatio: "landscape", campaign: { durationRange: { min: 15, max: 60 }, aspectRatio: "portrait" } });
  assert.deepEqual(validateClipJob(conflict).issues.map(i => i.code).sort(), ["CAMPAIGN_ASPECT_CONFLICT", "CAMPAIGN_DURATION_CONFLICT"]);
});
test("fingerprint is stable for identical jobs and changes with provider/content", async () => {
  const a = createClipJob({ source: { url: "https://a.com/v?x=1" }, prompt: "p" });
  const b = createClipJob({ source: { url: "https://A.com/v?x=1" }, prompt: "p", idempotencyKey: "ignored" });
  assert.equal(await computeJobFingerprint(a, "opusclip"), await computeJobFingerprint(b, "opusclip"));
  assert.notEqual(await computeJobFingerprint(a, "opusclip"), await computeJobFingerprint(a, "local"));
  assert.notEqual(await computeJobFingerprint(a, "opusclip"), await computeJobFingerprint({ ...a, prompt: "q" }, "opusclip"));
  assert.match(await computeJobFingerprint(a, "x"), /^[0-9a-f]{64}$/);
});
test("JobRecord lifecycle, checkpoints and retry", () => {
  const job = createClipJob({ source: { url: "https://a.com/x" } });
  let r = createJobRecord({ job, providerId: "opusclip", id: "j1", now: "2026-01-01T00:00:00.000Z" });
  assert.equal(r.status, "pending");
  assert.equal(r.checkpoints[0].name, CHECKPOINTS.CREATED);
  r = transitionJob(r, JOB_STATUS.SUBMITTING);
  assert.equal(r.attempts, 1);
  r = failJob(r, { code: "NETWORK_ERROR", message: "boom", retryable: true });
  assert.equal(r.status, "failed");
  assert.deepEqual(r.error, { code: "NETWORK_ERROR", message: "boom", retryable: true });
  r = transitionJob(r, JOB_STATUS.PENDING);
  r = transitionJob(r, JOB_STATUS.SUBMITTING);
  assert.equal(r.attempts, 2);
  r = addCheckpoint(r, CHECKPOINTS.SUBMIT_ACCEPTED, { providerJobId: "p9" });
  assert.equal(r.checkpoints.at(-1).data.providerJobId, "p9");
  r = transitionJob(transitionJob(r, "processing"), "completed");
  assert.equal(r.status, "completed");
});
test("illegal transitions are rejected and records are immutable", () => {
  const r = createJobRecord({ job: createClipJob({}), providerId: "x" });
  assert.throws(() => transitionJob(r, "completed"), /Illegal job transition/);
  const r2 = transitionJob(r, "submitting");
  assert.equal(r.status, "pending");
  assert.equal(r2.status, "submitting");
  assert.throws(() => transitionJob({ ...r, status: "completed" }, "pending"), /Illegal/);
});
test("switchProvider keeps job data and records history", () => {
  const job = createClipJob({ source: { url: "https://a.com/x" } });
  let r = createJobRecord({ job, providerId: "opusclip", id: "j2" });
  r = { ...r, provider: { id: "opusclip", jobId: "p1" } };
  const s = switchProvider(r, "local");
  assert.equal(s.id, "j2");
  assert.deepEqual(s.job, job);
  assert.deepEqual(s.provider, { id: "local", jobId: null });
  assert.equal(s.providerHistory[0].id, "opusclip");
  assert.equal(s.providerHistory[0].jobId, "p1");
});
test("extractClipRows / normalizeClip handle V6.2's tolerated response shapes", () => {
  assert.equal(extractClipRows({ clips: [1] }).length, 1);
  assert.equal(extractClipRows({ items: [1, 2] }).length, 2);
  assert.equal(extractClipRows({ data: [1] }).length, 1);
  assert.equal(extractClipRows([1, 2, 3]).length, 3);
  assert.deepEqual(extractClipRows({ clips: "no" }), []);
  assert.deepEqual(extractClipRows(null), []);
  const c = normalizeClip({ clipId: "c1", name: "Hi", preview_url: "https://p", download_url: "https://d", start: "5", endSec: 20, score: 0.9 }, 0);
  assert.deepEqual(c, { id: "c1", title: "Hi", previewUrl: "https://p", downloadUrl: "https://d", startSec: 5, endSec: 20, durationSec: 15, score: 0.9 });
  assert.equal(normalizeClip({}, 2).title, "Clip 3");
  assert.equal(normalizeClip({}, 0).durationSec, null);
});
