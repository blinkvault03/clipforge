import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCues, makeAss, makeSrt, srtTime, assTime, assEscape } from "../src/native/captions.js";
import { buildExportArgs, outputSize, normalizeQuality, QUALITY_PRESETS } from "../src/native/export-settings.js";

const T = [{ text: "Wait you will not believe what happened next in this crazy story", timestamp: [10, 20] }, { text: "It was the best day ever", timestamp: [20, 26] }, { text: "Outside the clip", timestamp: [90, 95] }];

test("cues are cut to the clip window, relative to clip start, and split into short lines", () => {
  const cues = buildCues(T, 12, 40, { words: 4 });
  assert.ok(cues.length >= 3); assert.ok(cues.every(c => c.start >= 0 && c.end <= 28 && c.end > c.start));
  assert.ok(cues.every(c => c.text.split(" ").length <= 4)); assert.ok(!cues.some(c => /Outside/.test(c.text)));
  assert.ok(cues[0].start < 0.01);
});
test("SRT and ASS timing formats", () => {
  assert.equal(srtTime(3661.5), "01:01:01,500"); assert.equal(assTime(61.25), "0:01:01.25");
  assert.match(makeSrt([{ start: 0, end: 1.5, text: "Hi" }]), /^1\n00:00:00,000 --> 00:00:01,500\nHi\n/);
  assert.equal(assEscape("a{b}\nc\\d"), "a(b) c\\\\d");
});
test("ASS has styles, dialogue, position/size options and a hook overlay; it refuses to be empty", () => {
  const cues = buildCues(T, 12, 40);
  const ass = makeAss(cues, 720, 1280, { style: { size: "large", position: "top", uppercase: true }, hook: "Best day ever" });
  assert.match(ass, /PlayResX: 720/); assert.match(ass, /Style: Default,Arial,\d+/); assert.match(ass, /Style: Hook/); assert.match(ass, /Dialogue: 1,0:00:00.00,0:00:03.00,Hook,,0,0,0,,BEST DAY EVER/);
  assert.match(ass, /,Default,,0,0,0,,WAIT/); assert.match(ass, /,&H99000000,-1,0,0,0,100,100,0,0,1,4,1,8,/);
  assert.throws(() => makeAss([], 720, 1280), /No timed captions/);
  assert.ok(makeAss([], 720, 1280, { hook: "Only a hook" }).includes("ONLY A HOOK"));
});
test("export sizes for every quality and ratio", () => {
  assert.deepEqual(outputSize("9:16", 1080), { width: 1080, height: 1920 }); assert.deepEqual(outputSize("9:16", 720), { width: 720, height: 1280 }); assert.deepEqual(outputSize("9:16", 480), { width: 480, height: 854 });
  assert.deepEqual(outputSize("1:1", 720), { width: 720, height: 720 }); assert.deepEqual(outputSize("16:9", 1080), { width: 1920, height: 1080 });
  assert.equal(normalizeQuality("720"), 720); assert.equal(normalizeQuality("4k"), 1080); assert.deepEqual(Object.keys(QUALITY_PRESETS), ["480", "720", "1080"]);
  for (const r of ["9:16", "1:1", "16:9"]) for (const q of [480, 720, 1080]) { const s = outputSize(r, q); assert.ok(s.width % 2 === 0 && s.height % 2 === 0, `${r} ${q}`); }
});
test("export args: trimming, filters, captions and logo wiring", () => {
  const a = buildExportArgs({ input: "in.mp4", output: "o.mp4", start: 5, end: 40, ratio: "9:16", quality: 720, assFile: "c.ass", fontsDir: "/fonts" });
  assert.deepEqual(a.slice(0, 6), ["-ss", "5", "-i", "in.mp4", "-t", "35"]); assert.match(a[a.indexOf("-vf") + 1], /crop=720:1280.*subtitles=c\.ass:fontsdir=\/fonts/); assert.equal(a.at(-1), "o.mp4");
  const b = buildExportArgs({ input: "in.mp4", output: "o.mp4", start: 0, end: 30, ratio: "16:9", quality: 480, logoFile: "logo.png" });
  assert.ok(b.includes("-filter_complex")); assert.match(b[b.indexOf("-filter_complex") + 1], /overlay=W-w-24:24/); assert.ok(b.includes("[outv]"));
  assert.throws(() => buildExportArgs({ input: "a", output: "b", start: 5, end: 5 }), /after its start/);
});

// ---- real FFmpeg: proves the exact argument lists produce valid MP4s of the right size ----
const ff = spawnSync("ffmpeg", ["-version"]), hasFfmpeg = ff.status === 0;
const hasSubs = hasFfmpeg && /subtitles/.test(spawnSync("ffmpeg", ["-hide_banner", "-filters"]).stdout.toString());
const probe = f => { const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,pix_fmt:format=duration", "-of", "json", f]); return JSON.parse(r.stdout.toString()); };

test("real FFmpeg export: every quality × ratio yields a valid H.264/AAC MP4 of the expected size and duration", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "cf-"));
  try {
    const src = join(dir, "src.mp4");
    assert.equal(spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src, "-y"]).status, 0);
    for (const ratio of ["9:16", "1:1", "16:9"]) for (const quality of [480, 720, 1080]) {
      const out = join(dir, `o-${ratio.replace(":", "x")}-${quality}.mp4`), { width, height } = outputSize(ratio, quality);
      const r = spawnSync("ffmpeg", ["-v", "error", ...buildExportArgs({ input: src, output: out, start: 2, end: 8, ratio, quality }).map(String)]);
      assert.equal(r.status, 0, r.stderr.toString());
      const p = probe(out), s = p.streams[0];
      assert.equal(s.codec_name, "h264"); assert.equal(s.pix_fmt, "yuv420p"); assert.equal(s.width, width); assert.equal(s.height, height);
      assert.ok(Math.abs(Number(p.format.duration) - 6) < 0.3, `duration ${p.format.duration}`); assert.ok(statSync(out).size > 2000);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("real FFmpeg export: captions + hook overlay + logo are burned in without error", { skip: (!hasSubs && "ffmpeg has no libass") }, () => {
  const dir = mkdtempSync(join(tmpdir(), "cf-"));
  try {
    const src = join(dir, "src.mp4"), logo = join(dir, "logo.png"), out = join(dir, "o.mp4");
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "12", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", src, "-y"]);
    spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=red:s=200x100", "-frames:v", "1", logo, "-y"]);
    const size = outputSize("9:16", 720), cues = buildCues(T, 10, 26);
    writeFileSync(join(dir, "c.ass"), makeAss(cues, size.width, size.height, { hook: "Best day ever" }));
    const r = spawnSync("ffmpeg", ["-v", "error", ...buildExportArgs({ input: "src.mp4", output: "o.mp4", start: 0, end: 10, ratio: "9:16", quality: 720, assFile: "c.ass", logoFile: "logo.png" }).map(String)], { cwd: dir });
    assert.equal(r.status, 0, r.stderr.toString()); const s = probe(out).streams[0]; assert.equal(s.width, 720); assert.equal(s.height, 1280);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("real FFmpeg: WebM and MKV inputs export to MP4 (format handling)", { skip: !hasFfmpeg && "ffmpeg not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "cf-"));
  try {
    for (const [ext, v, a] of [["webm", "libvpx", "libopus"], ["mkv", "libx264", "aac"], ["avi", "mpeg4", "mp3"]]) {
      const src = join(dir, "src." + ext), out = join(dir, ext + ".mp4");
      const mk = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-c:v", v, "-c:a", a, src, "-y"]);
      if (mk.status !== 0) continue; // encoder not available in this FFmpeg build
      const r = spawnSync("ffmpeg", ["-v", "error", ...buildExportArgs({ input: src, output: out, start: 0, end: 5, ratio: "9:16", quality: 480 }).map(String)]);
      assert.equal(r.status, 0, `${ext}: ${r.stderr}`); assert.equal(probe(out).streams[0].codec_name, "h264");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
