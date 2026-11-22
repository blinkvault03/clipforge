import test from "node:test";
import assert from "node:assert/strict";
import { opusclip, buildProjectRequest, OPUS_API } from "../src/providers/opusclip.js";
import { legacyToClipJob, createClipJob } from "../src/core/models.js";
import { ProviderError } from "../src/core/contract.js";
import { sanitizeProject } from "./fixtures/legacy_v63.js";
import { jsonResponse } from "./helpers.js";

const ENV = { OPUS_API_KEY: "sekret" };

// GOLDEN: the new path must forward byte-identical JSON to what V6.3 forwarded.
const BODIES = [
  { videoUrl: "https://youtu.be/abc" },
  { videoUrl: "https://youtu.be/abc", curationPref: { clipDurations: [[30, 60]], genre: "Auto", skipCurate: false, customPrompt: "hi" }, importPref: { sourceLang: "auto" }, renderPref: { layoutAspectRatio: "portrait" } },
  { videoUrl: "https://a.com/v", curationPref: { clipDurations: [[15, 30], [30, 60], [60, 90], [90, 120], [120, 150]], skipCurate: 1 }, renderPref: { layoutAspectRatio: "landscape" } },
  { videoUrl: "https://a.com/v", curationPref: { clipDurations: [["x", null], [undefined, "70"], ["5"]] } },
  { videoUrl: "https://a.com/v", curationPref: { clipDurations: [] } },
  { videoUrl: "https://a.com/v", curationPref: { clipDurations: "nope", genre: 7, customPrompt: 9 }, importPref: { sourceLang: 5 } },
  { videoUrl: "https://a.com/v", curationPref: { genre: "", customPrompt: "" }, importPref: { sourceLang: "" } },
  { videoUrl: "https://a.com/v", curationPref: { genre: "g".repeat(100), customPrompt: "p".repeat(700) }, importPref: { sourceLang: "abcdefghijklmnop" } },
  { videoUrl: "https://a.com/v", renderPref: { layoutAspectRatio: "square" } },
  { videoUrl: "https://a.com/v", curationPref: "oops", importPref: 3, renderPref: null },
  { videoUrl: 12345 },
  { videoUrl: "https://a.com/v", evil: "x", curationPref: { admin: true } }
];
BODIES.forEach((body, i) => test(`golden #${i}: ClipJob path == V6.3 sanitizeProject`, () => {
  assert.equal(JSON.stringify(buildProjectRequest(legacyToClipJob(body))), JSON.stringify(sanitizeProject(body)));
}));

test("builder refuses jobs the adapter cannot honour instead of silently degrading", () => {
  assert.throws(() => buildProjectRequest(createClipJob({ source: { url: "https://a.com" }, aspectRatio: "square" })), e => e instanceof ProviderError && e.code === "UNSUPPORTED_JOB" && e.httpStatus === 422);
  assert.throws(() => buildProjectRequest(createClipJob({ source: { type: "file", url: "x" } })), /cannot process "file"/);
});
test("submit: POST, bearer auth, no org header, returns raw + providerJobId", async () => {
  let seen;
  const fetch = async (u, o) => { seen = { u, o }; return jsonResponse({ projectId: "p1" }); };
  const r = await opusclip.submit(legacyToClipJob({ videoUrl: "https://a.com/v" }), { ...ENV, OPUS_ORG_ID: "org" }, { fetch });
  assert.equal(seen.u, `${OPUS_API}/clip-projects`);
  assert.equal(seen.o.method, "POST");
  assert.equal(seen.o.headers.Authorization, "Bearer sekret");
  assert.equal(seen.o.headers["x-opus-org-id"], undefined); // V6.3 behaviour
  assert.deepEqual(r, { ok: true, httpStatus: 200, providerJobId: "p1", raw: { projectId: "p1" } });
});
test("submit: providerJobId is found under id and project.id too", async () => {
  for (const [raw, id] of [[{ id: "a" }, "a"], [{ project: { id: "b" } }, "b"], [{}, null]]) {
    const r = await opusclip.submit(legacyToClipJob({ videoUrl: "https://a.com/v" }), ENV, { fetch: async () => jsonResponse(raw) });
    assert.equal(r.providerJobId, id);
  }
});
test("submit: upstream error status and non-JSON body pass through without throwing", async () => {
  const bad = await opusclip.submit(legacyToClipJob({ videoUrl: "https://a.com/v" }), ENV, { fetch: async () => jsonResponse({ error: "no credits" }, 402) });
  assert.deepEqual([bad.ok, bad.httpStatus, bad.raw.error], [false, 402, "no credits"]);
  const html = await opusclip.submit(legacyToClipJob({ videoUrl: "https://a.com/v" }), ENV, { fetch: async () => new Response("<html>", { status: 500 }) });
  assert.deepEqual([html.ok, html.httpStatus, html.raw, html.providerJobId], [false, 500, {}, null]);
});
test("submit: network failure rejects (caller maps it to 502)", async () => {
  await assert.rejects(opusclip.submit(legacyToClipJob({ videoUrl: "https://a.com/v" }), ENV, { fetch: async () => { throw new Error("ECONNRESET"); } }), /ECONNRESET/);
});
test("results: sends org header, normalises clips, derives status", async () => {
  let seen;
  const fetch = async (u, o) => { seen = { u, o }; return jsonResponse({ clips: [{ id: "c1", title: "T", previewUrl: "https://p", startTime: 1, endTime: 9 }] }); };
  const r = await opusclip.results("p 1", { ...ENV, OPUS_ORG_ID: "org" }, { fetch });
  assert.equal(seen.u, `${OPUS_API}/exportable-clips?q=findByProjectId&projectId=p%201`);
  assert.equal(seen.o.headers["x-opus-org-id"], "org");
  assert.equal(r.status, "completed");
  assert.equal(r.clips[0].durationSec, 8);
  assert.deepEqual(r.raw, { clips: [{ id: "c1", title: "T", previewUrl: "https://p", startTime: 1, endTime: 9 }] });
});
test("results: no clips yet => processing; upstream failure => structured error, no clips", async () => {
  const empty = await opusclip.results("p1", ENV, { fetch: async () => jsonResponse({ clips: [] }) });
  assert.deepEqual([empty.ok, empty.status, empty.clips], [true, "processing", []]);
  const fail = await opusclip.results("p1", ENV, { fetch: async () => jsonResponse({ message: "not found" }, 404) });
  assert.deepEqual([fail.ok, fail.httpStatus, fail.status, fail.clips], [false, 404, null, []]);
  assert.deepEqual(fail.error, { code: "UPSTREAM_ERROR", message: "not found" });
});
test("health reflects configuration only", async () => {
  assert.equal((await opusclip.health(ENV)).status, "available");
  assert.equal((await opusclip.health({})).status, "unconfigured");
  assert.equal(opusclip.isConfigured(undefined), false);
});
