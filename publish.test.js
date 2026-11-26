import test from "node:test";
import assert from "node:assert/strict";
import { buildYoutubeMetadata, uploadToYouTube, canShareFile, manualPostSteps, PLATFORMS, YT_UPLOAD_URL } from "../src/native/publish.js";

test("YouTube metadata: Shorts tag for vertical clips, privacy default private, length limits", () => {
  const m = buildYoutubeMetadata({ title: "My hook", caption: "Cool clip #brand", ratio: "9:16" });
  assert.match(m.snippet.title, /#Shorts/); assert.match(m.snippet.description, /#Shorts/); assert.equal(m.status.privacyStatus, "private"); assert.equal(m.status.selfDeclaredMadeForKids, false);
  const land = buildYoutubeMetadata({ title: "T", caption: "c", ratio: "16:9", privacy: "public" }); assert.doesNotMatch(land.snippet.title, /Shorts/); assert.equal(land.status.privacyStatus, "public");
  assert.equal(buildYoutubeMetadata({ privacy: "everyone" }).status.privacyStatus, "private");
  assert.ok(buildYoutubeMetadata({ title: "x".repeat(300), ratio: "9:16" }).snippet.title.length <= 100);
  assert.ok(!/[<>]/.test(buildYoutubeMetadata({ title: "<b>x</b>" }).snippet.title));
});
test("upload follows the resumable protocol: start session, PUT bytes, return video URL", async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url === YT_UPLOAD_URL) return new Response("{}", { status: 200, headers: { Location: "https://upload.example/session1" } });
    return new Response(JSON.stringify({ id: "abc123XYZ_0" }), { status: 200 });
  };
  const blob = new Blob([new Uint8Array(2048)], { type: "video/mp4" });
  const r = await uploadToYouTube({ blob, accessToken: "tok", metadata: buildYoutubeMetadata({ title: "t" }), fetchImpl });
  assert.equal(r.id, "abc123XYZ_0"); assert.equal(r.url, "https://www.youtube.com/watch?v=abc123XYZ_0");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer tok"); assert.equal(calls[0].opts.headers["X-Upload-Content-Length"], "2048"); assert.equal(calls[1].url, "https://upload.example/session1"); assert.equal(calls[1].opts.method, "PUT"); assert.equal(calls[1].opts.body, blob);
});
test("upload errors are explained", async () => {
  const blob = new Blob([new Uint8Array(10)]);
  await assert.rejects(uploadToYouTube({ blob, accessToken: "", metadata: {} }), /Connect YouTube/);
  await assert.rejects(uploadToYouTube({ blob: new Blob([]), accessToken: "t", metadata: {} }), /Export a clip/);
  await assert.rejects(uploadToYouTube({ blob, accessToken: "t", metadata: {}, fetchImpl: async () => new Response(JSON.stringify({ error: { message: "quotaExceeded" } }), { status: 403 }) }), /HTTP 403: quotaExceeded.*quota/);
  await assert.rejects(uploadToYouTube({ blob, accessToken: "t", metadata: {}, fetchImpl: async () => new Response("{}", { status: 401 }) }), /sign-in expired/);
  await assert.rejects(uploadToYouTube({ blob, accessToken: "t", metadata: {}, fetchImpl: async () => new Response("{}", { status: 200 }) }), /no upload location/);
});
test("share-sheet detection and honest guidance for platforms that cannot be posted to directly", () => {
  assert.equal(canShareFile({ canShare: () => true, share: () => {} }, {}), true); assert.equal(canShareFile({}, {}), false); assert.equal(canShareFile(undefined, {}), false);
  assert.equal(canShareFile({ canShare: () => { throw new Error("x"); }, share() {} }, {}), false);
  assert.equal(PLATFORMS["YouTube Shorts"].direct, true); for (const p of ["TikTok", "Instagram Reels", "X"]) { assert.equal(PLATFORMS[p].direct, false); assert.match(manualPostSteps(p), /does not allow posting from a static website/); assert.match(PLATFORMS[p].uploadPage, /^https:\/\//); }
});
