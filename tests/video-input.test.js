import test from "node:test";
import assert from "node:assert/strict";
import { validateVideoFile, validateMediaUrl, safeExtension, parseFfmpegDuration, HARD_LIMIT_BYTES, SOFT_LIMIT_BYTES, VIDEO_EXTENSIONS } from "../src/native/video-input.js";

const f = (name, type = "", size = 5e6) => ({ name, type, size });

test("MP4 and WebM are accepted and play natively", () => {
  for (const x of [f("a.mp4", "video/mp4"), f("b.webm", "video/webm"), f("c.MOV", "video/quicktime")]) {
    const r = validateVideoFile(x); assert.ok(r.ok, x.name); assert.equal(r.needsProxy, false, x.name);
  }
});
test("other containers are accepted but flagged for a preview proxy", () => {
  for (const name of ["a.mkv", "b.avi", "c.flv", "d.wmv", "e.ts", "f.3gp", "g.mpg"]) {
    const r = validateVideoFile(f(name, "")); assert.ok(r.ok, name); assert.equal(r.needsProxy, true, name); assert.ok(r.warnings.length);
  }
});
test("a video MIME with an unknown extension is still accepted", () => assert.ok(validateVideoFile(f("clip", "video/x-matroska")).ok));
test("non-video, empty and oversized files are rejected with clear messages", () => {
  assert.match(validateVideoFile(f("notes.txt", "text/plain")).error, /does not look like a video/);
  assert.match(validateVideoFile(f("a.mp4", "video/mp4", 0)).error, /empty/);
  assert.match(validateVideoFile(f("a.mp4", "video/mp4", HARD_LIMIT_BYTES + 1)).error, /2 GB/);
  assert.equal(validateVideoFile(null).ok, false);
});
test("files above 1 GB warn but are allowed", () => {
  const r = validateVideoFile(f("big.mp4", "video/mp4", SOFT_LIMIT_BYTES + 1)); assert.ok(r.ok); assert.ok(r.warnings.some(w => /Large file/.test(w)));
});
test("safeExtension never returns something unsafe for the FFmpeg file system", () => {
  assert.equal(safeExtension("x.MKV"), "mkv"); assert.equal(safeExtension("x.exe", "video/webm"), "webm"); assert.equal(safeExtension("../../etc/passwd"), "mp4"); assert.ok(VIDEO_EXTENSIONS.includes(safeExtension("a.b.mov")));
});
test("FFmpeg duration lines are parsed", () => {
  assert.equal(parseFfmpegDuration("  Duration: 00:01:23.50, start: 0.000000, bitrate: 1 kb/s"), 83.5);
  assert.equal(parseFfmpegDuration("Duration: N/A"), null);
});
test("media URL validation", () => {
  assert.ok(validateMediaUrl("https://cdn.example.com/a.mp4").ok);
  assert.ok(validateMediaUrl("http://localhost:8080/a.mp4").ok);
  for (const bad of ["", "nope", "http://example.com/a.mp4", "https://u:p@example.com/a.mp4"]) assert.equal(validateMediaUrl(bad).ok, false, bad);
});
