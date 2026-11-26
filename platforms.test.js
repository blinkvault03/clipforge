import test from "node:test";
import assert from "node:assert/strict";
import { classifySource, embedUrl, isImportable } from "../src/native/platforms.js";

test("YouTube watch, short, shorts, live and embed links are recognised", () => {
  for (const [url, kind] of [["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"], ["https://youtu.be/dQw4w9WgXcQ", "video"], ["https://m.youtube.com/shorts/dQw4w9WgXcQ", "video"], ["https://www.youtube.com/live/dQw4w9WgXcQ", "live"], ["https://www.youtube.com/embed/dQw4w9WgXcQ", "video"]]) {
    const r = classifySource(url);
    assert.equal(r.platform, "youtube", url); assert.equal(r.id, "dQw4w9WgXcQ"); assert.equal(r.kind, kind);
  }
});
test("Twitch live, VOD and clip links are recognised; embeds carry the parent host", () => {
  assert.deepEqual(pick(classifySource("https://www.twitch.tv/somestreamer")), { platform: "twitch", kind: "live", id: "somestreamer" });
  assert.deepEqual(pick(classifySource("https://www.twitch.tv/videos/123456789")), { platform: "twitch", kind: "vod", id: "123456789" });
  assert.equal(classifySource("https://clips.twitch.tv/FunnySlug-abc").kind, "clip");
  assert.match(embedUrl(classifySource("https://www.twitch.tv/somestreamer"), "me.github.io"), /player\.twitch\.tv\/\?channel=somestreamer&parent=me\.github\.io/);
  assert.match(embedUrl(classifySource("https://www.twitch.tv/videos/55555"), "x.dev"), /video=v55555&parent=x\.dev/);
});
test("Twitch reserved paths are not treated as channels", () => assert.equal(classifySource("https://www.twitch.tv/directory").platform, "unsupported"));
test("Vimeo and Kick are recognised; Kick has no embed", () => {
  assert.equal(classifySource("https://vimeo.com/123456789").platform, "vimeo");
  assert.equal(embedUrl(classifySource("https://vimeo.com/123456789")), "https://player.vimeo.com/video/123456789");
  assert.equal(classifySource("https://kick.com/someone").platform, "kick");
  assert.equal(embedUrl(classifySource("https://kick.com/someone")), null);
});
test("direct media and HLS links are importable; platform pages are preview-only", () => {
  const mp4 = classifySource("https://cdn.example.com/a/b/recording.MP4?token=1"), hls = classifySource("https://cdn.example.com/live/index.m3u8");
  assert.equal(mp4.platform, "direct"); assert.equal(hls.platform, "hls");
  assert.ok(isImportable(mp4) && isImportable(hls));
  assert.equal(isImportable(classifySource("https://youtu.be/dQw4w9WgXcQ")), false);
});
test("bad input is rejected with a reason", () => {
  for (const bad of ["", "   ", "not a url", "ftp://x.com/a.mp4", "javascript:alert(1)"]) assert.equal(classifySource(bad).platform, "invalid", bad);
  assert.equal(classifySource("https://example.com/page").platform, "unsupported");
  assert.equal(classifySource("https://www.youtube.com/watch?v=short").platform, "unsupported");
});
const pick = ({ platform, kind, id }) => ({ platform, kind, id });
