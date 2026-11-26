import test from "node:test";
import assert from "node:assert/strict";
import { parsePlaylist, pickVariant, downloadHls, HlsError } from "../src/native/hls.js";

const MASTER = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720\nmid/index.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=6000000,RESOLUTION=1920x1080\nhigh/index.m3u8\n`;
const MEDIA = (extra = "", end = true) => `#EXTM3U\n#EXT-X-TARGETDURATION:6\n${extra}#EXTINF:6.0,\nseg0.ts\n#EXTINF:6.0,\nseg1.ts\n#EXTINF:4.5,\nseg2.ts\n${end ? "#EXT-X-ENDLIST\n" : ""}`;

test("master playlists list variants; pickVariant respects the height cap", () => {
  const p = parsePlaylist(MASTER, "https://h.example/live/master.m3u8");
  assert.equal(p.type, "master"); assert.equal(p.variants.length, 3);
  assert.equal(p.variants[0].url, "https://h.example/live/low/index.m3u8");
  assert.equal(pickVariant(p.variants, 720).height, 720); assert.equal(pickVariant(p.variants, 1080).height, 1080); assert.equal(pickVariant(p.variants, 240).height, 360);
});
test("media playlists give resolved segments, live flag and total time", () => {
  const p = parsePlaylist(MEDIA("", false), "https://h.example/a/index.m3u8");
  assert.equal(p.segments.length, 3); assert.equal(p.segments[2].url, "https://h.example/a/seg2.ts"); assert.equal(p.live, true); assert.equal(p.totalSeconds, 16.5);
  assert.equal(parsePlaylist(MEDIA(), "https://h.example/a/index.m3u8").live, false);
});
test("non-HLS text and encrypted streams are refused", async () => {
  assert.throws(() => parsePlaylist("<html>", "https://x"), e => e instanceof HlsError && e.code === "NOT_HLS");
  const enc = MEDIA('#EXT-X-KEY:METHOD=AES-128,URI="k.key"\n');
  await assert.rejects(downloadHls("https://h.example/a/index.m3u8", { fetchImpl: async () => new Response(enc) }), e => e.code === "ENCRYPTED");
});
test("downloadHls follows the master, fetches segments in order and respects maxSeconds", async () => {
  const seen = [];
  const fetchImpl = async url => {
    seen.push(url);
    if (url.endsWith("master.m3u8")) return new Response(MASTER);
    if (url.endsWith("mid/index.m3u8")) return new Response(MEDIA());
    return new Response(new Uint8Array([1, 2, 3]));
  };
  const progress = [];
  const r = await downloadHls("https://h.example/master.m3u8", { fetchImpl, maxHeight: 720, onProgress: (d, t) => progress.push([d, t]) });
  assert.equal(r.parts.length, 3); assert.equal(r.seconds, 16.5); assert.equal(r.live, false);
  assert.deepEqual(seen.filter(u => u.endsWith(".ts")), ["https://h.example/mid/seg0.ts", "https://h.example/mid/seg1.ts", "https://h.example/mid/seg2.ts"]);
  assert.deepEqual(progress.at(-1), [3, 3]);
  const short = await downloadHls("https://h.example/mid/index.m3u8", { fetchImpl, maxSeconds: 6 }); assert.equal(short.parts.length, 1);
});
test("HTTP errors surface clearly", async () => {
  await assert.rejects(downloadHls("https://h.example/x.m3u8", { fetchImpl: async () => new Response("no", { status: 403 }) }), /HTTP 403/);
});
