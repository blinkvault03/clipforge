import test from "node:test";
import assert from "node:assert/strict";
import { assertProvider, checkJobCompatibility, ProviderError, ERROR_CODES } from "../src/core/contract.js";
import { createRegistry } from "../src/core/registry.js";
import { createDefaultRegistry } from "../src/providers/index.js";
import { opusclip } from "../src/providers/opusclip.js";
import { createClipJob } from "../src/core/models.js";
import { makeFakeProvider } from "./helpers.js";

const job = (o = {}) => createClipJob({ source: { url: "https://a.com/x" }, ...o });

test("a valid provider passes assertProvider", () => assert.doesNotThrow(() => assertProvider(makeFakeProvider())));
test("assertProvider lists every problem", () => {
  assert.throws(() => assertProvider({ id: "Bad Id" }), e => e instanceof TypeError && /id must match/.test(e.message) && /missing method submit/.test(e.message) && /capabilities are required/.test(e.message));
  assert.throws(() => assertProvider(null), /must be an object/);
  assert.throws(() => assertProvider(makeFakeProvider({ cost: "cheap" })), /cost must be one of/);
  assert.throws(() => assertProvider(makeFakeProvider({ dataFlow: "cloud" })), /dataFlow/);
  assert.throws(() => assertProvider(makeFakeProvider({ health: undefined })), /missing method health/);
});
test("OpusClip satisfies the contract and is declared paid + third-party", () => {
  assert.doesNotThrow(() => assertProvider(opusclip));
  assert.equal(opusclip.cost, "paid");
  assert.equal(opusclip.dataFlow, "third-party");
});
test("registry: register, get, list, duplicate rejection, unknown id", () => {
  const reg = createRegistry([makeFakeProvider()], { defaultId: "fake" });
  assert.equal(reg.get("fake").id, "fake");
  assert.equal(reg.list().length, 1);
  assert.throws(() => reg.register(makeFakeProvider()), /already registered/);
  assert.throws(() => reg.register({}), TypeError);
  assert.throws(() => reg.resolve("nope"), e => e instanceof ProviderError && e.code === ERROR_CODES.UNKNOWN_PROVIDER);
  assert.equal(reg.resolve().id, "fake");
});
test("registry works with no OpusClip registered (it is optional)", () => {
  const reg = createRegistry([makeFakeProvider()]);
  assert.equal(reg.has("opusclip"), false);
  assert.equal(reg.defaultId(), "fake");
  assert.equal(createRegistry([]).defaultId(), null);
  assert.throws(() => createRegistry([]).resolve(), /Unknown provider/);
});
test("default registry keeps OpusClip as default for V6.2 compatibility", () => assert.equal(createDefaultRegistry().defaultId(), "opusclip"));
test("compatibility: a compatible job has no reasons", () => {
  const r = checkJobCompatibility(opusclip, job());
  assert.deepEqual(r, { providerId: "opusclip", compatible: true, reasons: [] });
});
test("compatibility: availability is separate from job compatibility", async () => {
  const unconfigured = await opusclip.health({});
  assert.equal(unconfigured.status, "unconfigured");
  assert.equal(checkJobCompatibility(opusclip, job()).compatible, true); // unavailable provider can still be compatible
});
test("compatibility: blocking reasons are specific and all reported", () => {
  const r = checkJobCompatibility(opusclip, job({ aspectRatio: "square", source: { type: "file", url: "x" }, durations: [[1, 2], [3, 4], [5, 6], [7, 8]] }));
  assert.equal(r.compatible, false);
  const codes = r.reasons.filter(x => x.severity === "blocking").map(x => x.code).sort();
  assert.deepEqual(codes, ["UNSUPPORTED_ASPECT_RATIO", "UNSUPPORTED_SOURCE_TYPE"]);
  assert.match(r.reasons.find(x => x.code === "UNSUPPORTED_ASPECT_RATIO").message, /OpusClip does not support the square/);
});
test("compatibility: duration limits and too many ranges", () => {
  const p = makeFakeProvider();
  assert.equal(checkJobCompatibility(p, job({ durations: [[5, 30]] })).reasons[0].code, "DURATION_OUT_OF_RANGE");
  assert.equal(checkJobCompatibility(p, job({ durations: [[20, 30], [30, 40], [40, 50]] })).reasons[0].code, "TOO_MANY_DURATION_RANGES");
  assert.equal(checkJobCompatibility(p, job({ durations: [[20, 30]] })).compatible, true);
});
test("compatibility: ignored options are warnings, not blockers", () => {
  const r = checkJobCompatibility(makeFakeProvider(), job({ prompt: "funny", genre: "Auto", language: "hi" }));
  assert.equal(r.compatible, true);
  assert.deepEqual(r.reasons.map(x => x.code).sort(), ["GENRE_NOT_SUPPORTED", "LANGUAGE_NOT_SUPPORTED", "PROMPT_NOT_SUPPORTED"]);
  assert.ok(r.reasons.every(x => x.severity === "warning"));
});
test("compatibility: campaign rules the provider cannot enforce are flagged as warnings", () => {
  const campaign = { durationRange: { min: 15, max: 60 }, hooks: ["Wait for it"], hashtags: ["#a"], overlays: [{ type: "logo" }], prohibited: { terms: ["x"] }, captions: { required: true } };
  const r = checkJobCompatibility(opusclip, job({ campaign }));
  assert.equal(r.compatible, true);
  assert.deepEqual(r.reasons.map(x => x.code).sort(), [
    "CAMPAIGN_CAPTIONS_NOT_ENFORCED", "CAMPAIGN_HASHTAGS_NOT_ENFORCED", "CAMPAIGN_HOOKS_NOT_ENFORCED", "CAMPAIGN_OVERLAYS_NOT_ENFORCED", "CAMPAIGN_PROHIBITED_CONTENT_NOT_ENFORCED"
  ]);
  const enforced = checkJobCompatibility(makeFakeProvider(), job({ campaign: { captions: { required: true } } }));
  assert.deepEqual(enforced.reasons, []);
});
test("ProviderError carries code, retryable flag and status", () => {
  const e = new ProviderError("X", "msg", { retryable: true, httpStatus: 503 });
  assert.equal(e.name, "ProviderError");
  assert.equal(e.retryable, true);
  assert.equal(e.httpStatus, 503);
  assert.ok(e instanceof Error);
});
