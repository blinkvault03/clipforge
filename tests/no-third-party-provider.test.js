import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === ".git" || n.startsWith(".app-under-test")) continue;
    const p = join(dir, n); statSync(p).isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
// Terms are assembled from pieces so this file itself never contains the literal strings.
const FORBIDDEN = [["opus", "clip"], ["opus", " clip"], ["opus", ".pro"], ["OPUS", "_API_KEY"], ["OPUS", "_ORG_ID"], ["ENABLE_", "OPUS", "CLIP_PROVIDER"], ["x-opus", "-org-id"]].map(p => p.join(""));

test("repository contains no references to the removed third-party clipping provider", () => {
  const hits = [];
  for (const f of walk(root)) {
    if (/\.(png|jpg|jpeg|gif|webp|mp4|webm|zip)$/i.test(f)) continue;
    const text = readFileSync(f, "utf8").toLowerCase();
    for (const term of FORBIDDEN) if (text.includes(term.toLowerCase())) hits.push(`${relative(root, f)}: ${term}`);
  }
  assert.deepEqual(hits, []);
});
test("the provider/worker layer and its config are gone", () => {
  for (const p of ["worker.js", "wrangler.toml", "src/providers", "src/core"]) assert.equal(existsSync(join(root, p)), false, p);
});
test("the page has no backend/provider controls and makes no requests to a clipping API", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  for (const bad of ["cfApiBase", "clip-projects", "exportable-clips", "urlClipPanel", "submitUrlClip", "Provider not connected", "backend address", "workers.dev"]) assert.ok(!html.includes(bad), bad);
});
test("native engine pieces are present and wired into the page", () => {
  const html = readFileSync(join(root, "index.html"), "utf8");
  for (const m of ["highlights", "captions", "export-settings", "campaigns", "publish", "platforms", "video-input", "hls"]) { assert.ok(existsSync(join(root, "src/native", m + ".js")), m); assert.ok(html.includes(`./src/native/${m}.js`), `${m} not imported by the page`); }
  for (const lib of ["@huggingface/transformers", "@ffmpeg/ffmpeg", "@ffmpeg/core"]) assert.ok(html.includes(lib), lib);
});
test("CI runs on pushes and pull requests to both the working branch and main, with Node 22", () => {
  const wf = readFileSync(join(root, ".github/workflows/test.yml"), "utf8");
  assert.match(wf, /v6\.5-native-engine/); assert.match(wf, /\bmain\b/); assert.match(wf, /node-version: 22/); assert.match(wf, /npm test/);
});
