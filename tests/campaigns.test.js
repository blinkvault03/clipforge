import test from "node:test";
import assert from "node:assert/strict";
import { blankCampaign, normalizeCampaign, loadCampaigns, saveCampaigns, checkClip, parseBrief, durationRange, parseList, CAMPAIGNS_KEY, LEGACY_PROFILES_KEY } from "../src/native/campaigns.js";

const mem = (init = {}) => { const m = { ...init }; return { getItem: k => m[k] ?? null, setItem: (k, v) => { m[k] = String(v); }, m }; };

test("multiple campaigns persist, round-trip and keep the active one", () => {
  const s = mem(); const a = blankCampaign("Brand A"), b = { ...blankCampaign("Brand B"), quality: 720, platform: "TikTok" };
  saveCampaigns(s, { campaigns: [a, b], activeId: b.id });
  const r = loadCampaigns(s); assert.equal(r.campaigns.length, 2); assert.equal(r.activeId, b.id); assert.equal(r.campaigns[1].quality, 720); assert.notEqual(a.id, b.id);
});
test("old single-list profiles migrate, with resolution → quality", () => {
  const s = mem({ [LEGACY_PROFILES_KEY]: JSON.stringify([{ name: "Old", resolution: "720", platform: "X", duration: "45" }]) });
  const r = loadCampaigns(s); assert.equal(r.campaigns[0].name, "Old"); assert.equal(r.campaigns[0].quality, 720); assert.equal(r.campaigns[0].duration, "45"); assert.equal(r.activeId, r.campaigns[0].id);
});
test("corrupt storage starts clean instead of throwing", () => assert.deepEqual(loadCampaigns(mem({ [CAMPAIGNS_KEY]: "{not json" })), { campaigns: [], activeId: null }));
test("normalizeCampaign repairs bad values", () => { const c = normalizeCampaign({ name: "x", duration: "99", ratio: "4:3", quality: "9000" }); assert.equal(c.duration, "30-60"); assert.equal(c.ratio, "9:16"); assert.equal(c.quality, 1080); });
test("campaign rules: duration, required terms/hashtags, prohibited terms, logo", () => {
  const c = normalizeCampaign({ name: "C", duration: "30-60", required: "#brand, launch", prohibited: "spoiler", caption: "Check it #brand", brief: "The logo is required on every clip." });
  assert.equal(checkClip(c, { start: 0, end: 20, quote: "launch day", title: "" }, { hasLogo: true }).ok, false);
  const ok = checkClip(c, { start: 0, end: 45, quote: "big launch day", title: "" }, { hasLogo: true }); assert.deepEqual(ok, { ok: true, issues: [] });
  assert.match(checkClip(c, { start: 0, end: 45, quote: "big launch day", title: "" }, { hasLogo: false }).issues.join(" "), /logo/);
  assert.match(checkClip(c, { start: 0, end: 45, quote: "no spoiler here but launch", title: "" }, { hasLogo: true }).issues.join(" "), /Prohibited/);
  assert.match(checkClip({ ...c, caption: "" }, { start: 0, end: 45, quote: "launch", title: "" }, { hasLogo: true }).issues.join(" "), /Required terms/);
  assert.equal(checkClip({ ...c, enabled: false }, { start: 0, end: 5, quote: "", title: "" }).ok, true);
  assert.equal(checkClip(null, { start: 0, end: 5 }).ok, true);
});
test("brief parser extracts duration, platform, quality, ratio, tags, prohibited terms and caption", () => {
  const { fields, notes } = parseBrief("Clip duration: 45 seconds. Post to TikTok in 720p vertical. Use #Launch #Brand.\nProhibited: spoilers, competitors.\nCaption: Watch now #Launch\n\nNo music allowed, original audio only.");
  assert.equal(fields.duration, "45"); assert.equal(fields.platform, "TikTok"); assert.equal(fields.quality, 720); assert.equal(fields.ratio, "9:16");
  assert.deepEqual(fields.requiredTags, ["#Launch", "#Brand"]); assert.deepEqual(fields.prohibited, ["spoilers", "competitors"]); assert.match(fields.caption, /Watch now/); assert.ok(notes.some(n => /Audio restriction/.test(n)));
  assert.ok(parseBrief("Post on TikTok and Instagram Reels").notes.some(n => /Multiple platforms/.test(n)));
});
test("helpers", () => { assert.deepEqual(durationRange("30-60"), [30, 60]); assert.deepEqual(durationRange("45"), [45, 45]); assert.deepEqual(parseList("a, b;c\nd"), ["a", "b", "c", "d"]); });
