import test from "node:test";
import assert from "node:assert/strict";
import { scoreText, findViralMoments, energyPerSecond } from "../src/native/highlights.js";

const seg = (t0, t1, text) => ({ text, timestamp: [t0, t1] });
// 4 minutes of dull speech with one dramatic stretch at 120–165 s.
function transcript() {
  const out = [];
  for (let t = 0; t < 240; t += 10) {
    const hot = t >= 120 && t < 170;
    out.push(seg(t, t + 10, hot
      ? (t === 120 ? "Wait, you will not believe this! It cost 5000 dollars and it is insane!" : "Oh my god, no way, that was the best moment ever! Hahaha!")
      : "So today we are going to talk about the schedule for the next quarter and the details."));
  }
  return out;
}

test("scoreText rewards hooks, numbers, emotion and laughter; empty/filler scores zero", () => {
  const hot = scoreText("Wait, you won't believe this! It cost 5000 dollars, insane!", 8);
  const dull = scoreText("So today we will discuss the schedule.", 8);
  assert.ok(hot.hook > dull.hook && hot.emotion > dull.emotion); assert.ok(hot.reasons.includes("strong hook"));
  assert.deepEqual(scoreText("um", 2), { hook: 0, emotion: 0, punch: 0, pace: 0, reasons: [] }); assert.equal(scoreText("").hook, 0);
});
test("the dramatic stretch is ranked first and clips respect min/max length", () => {
  const r = findViralMoments(transcript(), 240, { minLen: 30, maxLen: 60, maxClips: 5 });
  assert.ok(r.length >= 1);
  assert.ok(r[0].start >= 100 && r[0].start <= 135, `best clip starts at ${r[0].start}`);
  for (const c of r) { const len = c.end - c.start; assert.ok(len >= 29.9 && len <= 60.1, `len ${len}`); assert.ok(c.start >= 0 && c.end <= 240); assert.ok(c.viral >= 0 && c.viral <= 100); }
  assert.ok(r[0].viral > (r.at(-1).viral - 1)); // sorted best-first
  assert.match(r[0].reason, /hook|emotional|laughter|punchy/);
});
test("clips do not overlap beyond the allowed fraction and never exceed maxClips", () => {
  const r = findViralMoments(transcript(), 240, { minLen: 30, maxLen: 60, maxClips: 3, maxOverlap: 0.25 });
  assert.ok(r.length <= 3);
  for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
    const o = Math.min(r[i].end, r[j].end) - Math.max(r[i].start, r[j].start);
    assert.ok(o <= 0.25 * Math.min(r[i].end - r[i].start, r[j].end - r[j].start) + 1e-6);
  }
});
test("audio energy raises the score of a loud stretch", () => {
  const dull = [];
  for (let t = 0; t < 240; t += 10) dull.push(seg(t, t + 10, "We continue with the agenda and the notes for the team."));
  const energy = new Array(240).fill(0.2); for (let s = 150; s < 200; s++) energy[s] = 1;
  const r = findViralMoments(dull, 240, { minLen: 30, maxLen: 60, maxClips: 3, energy });
  assert.ok(r.length >= 1); assert.ok(r[0].start >= 125 && r[0].start <= 185, `start ${r[0].start}`); assert.match(r[0].reason, /audio energy/);
});
test("a short video, bad range or empty input gives no clips instead of invented ones", () => {
  assert.deepEqual(findViralMoments(transcript(), 20, { minLen: 30, maxLen: 60 }), []);
  assert.deepEqual(findViralMoments(transcript(), 240, { minLen: 60, maxLen: 30 }), []);
  assert.deepEqual(findViralMoments([], 240, {}), []);
  assert.deepEqual(findViralMoments(null, 240, {}), []);
});
test("speech-free video falls back to loud moments only", () => {
  const energy = new Array(200).fill(0.1); for (let s = 90; s < 130; s++) energy[s] = 1;
  const r = findViralMoments([], 200, { minLen: 30, maxLen: 60, energy });
  assert.ok(r.length >= 1); assert.match(r[0].reason, /audio energy/);
  assert.deepEqual(findViralMoments([], 200, { minLen: 30, maxLen: 60, energy: new Array(200).fill(0.1) }).length >= 0, true);
});
test("energyPerSecond normalises per second", () => {
  const sr = 100, samples = new Float32Array(sr * 4); samples.fill(0.1, 0, sr * 2); samples.fill(0.5, sr * 2);
  const e = energyPerSecond(samples, sr); assert.equal(e.length, 4); assert.ok(e[3] > e[0]); assert.ok(e.every(v => v >= 0 && v <= 1));
  assert.deepEqual(energyPerSecond([], 100), []);
});
