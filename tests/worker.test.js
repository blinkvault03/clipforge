import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { sanitizeProject } from "./fixtures/legacy_v63.js";

const realFetch = globalThis.fetch;
let calls;
const stub = (impl) => { calls = []; globalThis.fetch = async (u, o) => { calls.push({ u, o }); return impl(u, o); }; };
test.afterEach(() => { globalThis.fetch = realFetch; });

const call = (env, path, { method = "GET", body, origin = "https://me.github.io" } = {}) =>
  worker.fetch(new Request("https://x.workers.dev" + path, { method, headers: { Origin: origin }, body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)) }), env);
const OK = { OPUS_API_KEY: "k" };

test("V6.2 health shape is preserved (+corsLocked from V6.3)", async () => {
  assert.deepEqual(await (await call(OK, "/api/health")).json(), { ok: true, provider: "opusclip", configured: true, corsLocked: false });
  assert.deepEqual(await (await call({}, "/api/health")).json(), { ok: true, provider: "opusclip", configured: false, corsLocked: false });
});
test("unconfigured backend -> 503 with the V6.2 message on every non-health route", async () => {
  for (const [p, m] of [["/api/clip-projects", "POST"], ["/api/exportable-clips?projectId=1", "GET"], ["/api/nope", "GET"]]) {
    const r = await call({}, p, { method: m, body: m === "POST" ? {} : undefined });
    assert.equal(r.status, 503);
    assert.equal((await r.json()).error, "Backend is not configured. Add OPUS_API_KEY as a Worker secret.");
  }
});
test("POST /api/clip-projects forwards exactly the V6.3 body and passes the upstream status through", async () => {
  const body = { videoUrl: "https://youtu.be/abc", curationPref: { clipDurations: [[30, 60]], genre: "Auto", customPrompt: "x", evil: 1 }, importPref: { sourceLang: "auto" }, renderPref: { layoutAspectRatio: "portrait" }, admin: true };
  stub(() => new Response(JSON.stringify({ projectId: "p1" }), { status: 201 }));
  const r = await call(OK, "/api/clip-projects", { method: "POST", body });
  assert.equal(r.status, 201);
  assert.deepEqual(await r.json(), { projectId: "p1" });
  assert.equal(calls[0].u, "https://api.opus.pro/api/clip-projects");
  assert.equal(calls[0].o.body, JSON.stringify(sanitizeProject(body)));
  assert.equal(calls[0].o.headers.Authorization, "Bearer k");
});
test("input validation: non-HTTPS, missing url, bad/null JSON -> 400, never reaches upstream", async () => {
  stub(() => { throw new Error("should not be called"); });
  for (const body of [{ videoUrl: "http://a.com" }, {}, "not json", "null", "[]"]) {
    const r = await call(OK, "/api/clip-projects", { method: "POST", body });
    assert.equal(r.status, 400);
  }
  assert.equal(calls.length, 0);
});
test("upstream provider failure (402) is passed through, not swallowed", async () => {
  stub(() => new Response(JSON.stringify({ error: "no credits" }), { status: 402 }));
  const r = await call(OK, "/api/clip-projects", { method: "POST", body: { videoUrl: "https://a.com/v" } });
  assert.equal(r.status, 402);
  assert.equal((await r.json()).error, "no credits");
});
test("network failure -> 502 with message; other routes keep working afterwards", async () => {
  stub(() => { throw new Error("ECONNRESET"); });
  const r = await call(OK, "/api/clip-projects", { method: "POST", body: { videoUrl: "https://a.com/v" } });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).error, "ECONNRESET");
  assert.equal((await call(OK, "/api/health")).status, 200);
});
test("GET /api/exportable-clips: raw passthrough, org id header, projectId required", async () => {
  stub(() => new Response(JSON.stringify({ clips: [{ id: "c" }] }), { status: 200 }));
  const r = await call({ ...OK, OPUS_ORG_ID: "org" }, "/api/exportable-clips?projectId=p1");
  assert.deepEqual(await r.json(), { clips: [{ id: "c" }] });
  assert.equal(calls[0].u, "https://api.opus.pro/api/exportable-clips?q=findByProjectId&projectId=p1");
  assert.equal(calls[0].o.headers["x-opus-org-id"], "org");
  assert.equal((await call(OK, "/api/exportable-clips")).status, 400);
});
test("404, wrong method, OPTIONS preflight", async () => {
  assert.equal((await call(OK, "/api/nope")).status, 404);
  assert.equal((await call(OK, "/api/clip-projects", { method: "GET" })).status, 404);
  const pre = await call(OK, "/api/clip-projects", { method: "OPTIONS" });
  assert.equal(pre.status, 200);
  assert.match(pre.headers.get("access-control-allow-methods"), /POST/);
});
test("CORS: locked to ALLOWED_ORIGINS when set, open otherwise", async () => {
  const locked = { ...OK, ALLOWED_ORIGINS: "https://me.github.io, https://b.com" };
  assert.equal((await call(locked, "/api/health", { origin: "https://b.com" })).headers.get("access-control-allow-origin"), "https://b.com");
  assert.equal((await call(locked, "/api/health", { origin: "https://evil.com" })).headers.get("access-control-allow-origin"), "https://me.github.io");
  assert.equal((await call(OK, "/api/health", { origin: "https://evil.com" })).headers.get("access-control-allow-origin"), "*");
  assert.equal((await (await call(locked, "/api/health")).json()).corsLocked, true);
});
