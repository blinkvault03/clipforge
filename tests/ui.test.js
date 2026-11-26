import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { html, moduleScript, bootApp } from "./helpers/fake-dom.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const navHrefs = [...html.matchAll(/<a class="cf-nav[^"]*" href="(#[^"]+)"/g)].map(m => m[1].slice(1));

/* ------------------------------------------------------------- static checks */
test("every element id is unique", () => { const dup = ids.filter((x, i) => ids.indexOf(x) !== i); assert.deepEqual(dup, []); });

test("sidebar: exactly one sidebar, one toggle, and no duplicate navigation links", () => {
  assert.equal((html.match(/class="cf-sidebar"/g) || []).length, 1);
  assert.equal((html.match(/id="cfMenuToggle"/g) || []).length, 1);
  assert.equal(new Set(navHrefs).size, navHrefs.length, "two links point at the same section");
});
test("sidebar: every link targets a real section, and every major feature section has a link", () => {
  for (const id of navHrefs) assert.ok(ids.includes(id), `sidebar link #${id} has no matching section`);
  const required = ["dashboard", "sourcePanel", "analysisPanel", "reviewPanel", "trimPanel", "captionsPanel", "campaignPanel", "rightsPanel", "exportPanel", "publishPanel", "channelsPanel", "settingsPanel"];
  for (const id of required) { assert.ok(navHrefs.includes(id), `no sidebar link for #${id}`); assert.match(html, new RegExp(`<section[^>]*id="${id}"`), `#${id} is not a <section>`); }
});
test("sidebar links follow the on-page order of the sections", () => {
  const pos = navHrefs.map(id => html.indexOf(`id="${id}"`)); assert.deepEqual([...pos].sort((a, b) => a - b), pos);
});
test("sidebar CSS: fixed on desktop, off-canvas below 850px, toggle hidden on desktop", () => {
  assert.match(html, /\.cf-sidebar\{position:fixed;[^}]*left:0;top:66px;bottom:0;width:248px/);
  assert.match(html, /\.cf-menu-toggle\{display:none/); assert.match(html, /@media\(max-width:850px\)[\s\S]*\.cf-menu-toggle\{display:block\}[\s\S]*translateX\(-105%\)/);
  assert.match(html, /main\{max-width:none;margin:0 0 0 248px/); // content is offset by the sidebar width, so nothing is hidden underneath
  assert.match(html, /scroll-margin-top:84px/);
});
test("the menu toggle and the nav links each get exactly one event-listener setup", () => {
  assert.equal((moduleScript.match(/cfMenuToggle/g) || []).length, 1); assert.equal((moduleScript.match(/function initSidebar/g) || []).length, 1);
  assert.equal((html.match(/<script(?![^>]*type="module")/g) || []).length, 0, "no stray classic scripts (they ran outside <head>/<body> before)");
  assert.equal((html.match(/<script/g) || []).length, 1);
});
test("every id the script reads exists in the markup (no null-element crashes)", () => {
  const used = new Set([...moduleScript.matchAll(/\$\('([A-Za-z0-9_]+)'\)/g)].map(m => m[1]));
  for (const x of [...moduleScript.matchAll(/getElementById\('([^']+)'\)/g)].map(m => m[1])) used.add(x);
  for (const id of used) assert.ok(ids.includes(id), `script uses #${id} but it is not in the page`);
});
test("every local module import resolves and the imported names exist", async () => {
  for (const m of moduleScript.matchAll(/import \{([^}]+)\} from '(\.\/[^']+)'/g)) {
    const path = join(root, m[2]); assert.ok(existsSync(path), `${m[2]} is missing`);
    const mod = await import(path);
    for (const name of m[1].split(",").map(s => s.trim()).filter(Boolean)) assert.ok(name in mod, `${m[2]} does not export ${name}`);
  }
});
test("no broken asset paths: only CDN https URLs or existing local files", () => {
  for (const m of html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)) assert.ok(/^https:\/\//.test(m[1]) || existsSync(join(root, m[1])), m[1]);
});
test("the page is a valid single document", () => { assert.equal((html.match(/<html/g) || []).length, 1); assert.equal((html.match(/<\/body>/g) || []).length, 1); assert.ok(html.indexOf("</head>") < html.indexOf("<body>")); });

test("upload accepts all common video types and the app mentions every promised capability", () => {
  const accept = /id="fileInput" type="file" accept="([^"]+)"/.exec(html)[1];
  for (const e of ["video/*", ".mkv", ".avi", ".flv", ".wmv", ".ts", ".3gp", ".mpg", ".webm", ".mp4", ".mov"]) assert.ok(accept.includes(e), e);
  for (const q of ["480", "720", "1080"]) assert.match(html, new RegExp(`<option value="${q}"`));
  for (const id of ["burnCaptions", "hookOverlay", "startCapture", "postYoutube", "shareClip", "cfNewCampaign", "campaignSelect", "alsoSrt"]) assert.ok(ids.includes(id), id);
});

/* --------------------------------------------------------- behaviour (fake DOM) */
test("app boots with no errors and renders the dashboard defaults", async () => {
  const t = await bootApp();
  try {
    assert.equal(t.$("dashClips").textContent, "0"); assert.equal(t.$("dashQuality").textContent, "1080p"); assert.equal(t.$("exportSize").textContent, "1080 × 1920");
    assert.match(t.$("cfCampaignNav").children[0].textContent, /No campaigns yet/);
  } finally { t.restore(); }
});
test("mobile menu toggle opens and closes the sidebar; backdrop, Escape and link clicks close it", async () => {
  const t = await bootApp();
  try {
    const sb = t.$("cfSidebar"), tg = t.$("cfMenuToggle"), bd = t.$("cfBackdrop");
    tg.click(); assert.ok(sb.classList.contains("open")); assert.ok(bd.classList.contains("show")); assert.equal(tg.getAttribute("aria-expanded"), "true");
    tg.click(); assert.ok(!sb.classList.contains("open")); assert.equal(tg.getAttribute("aria-expanded"), "false");
    tg.click(); t.pressKey("Escape"); assert.ok(!sb.classList.contains("open"));
    tg.click(); bd.click(); assert.ok(!sb.classList.contains("open"));
    tg.click(); t.navLinks[3].click(); assert.ok(!sb.classList.contains("open")); assert.ok(t.navLinks[3].classList.contains("active")); assert.ok(!t.navLinks[0].classList.contains("active"));
    tg.click(); t.resize(); // innerWidth is 1200 → desktop layout closes the drawer
    assert.ok(!sb.classList.contains("open"));
  } finally { t.restore(); }
});
test("campaign sidebar: add campaigns, they appear as sidebar items, switch, save, delete, and persist", async () => {
  const t = await bootApp();
  try {
    t.$("cfNewCampaign").click(); t.$("cfNewCampaign").click();
    const nav = t.$("cfCampaignNav"); assert.equal(nav.children.length, 2); assert.equal(nav.children[0].children[1].textContent, "Campaign 1"); assert.equal(nav.children[1].children[1].textContent, "Campaign 2");
    assert.ok(nav.children[1].classList.contains("active"), "the newest campaign is active");
    let saved = JSON.parse(t.mem["clipforge.campaigns.v2"]); assert.equal(saved.campaigns.length, 2); assert.equal(saved.activeId, saved.campaigns[1].id);
    t.$("campaignName").value = "Brand X"; t.$("requiredTerms").value = "#brandx"; t.$("postCaption").value = "Hello #brandx"; t.$("exportQuality").value = "720"; t.$("saveCampaign").click();
    saved = JSON.parse(t.mem["clipforge.campaigns.v2"]); assert.equal(saved.campaigns[1].name, "Brand X"); assert.equal(saved.campaigns[1].quality, 720); assert.match(t.$("dashCampaign").textContent, /Brand X/);
    nav.children[0].click(); assert.ok(nav.children[0].classList.contains("active")); assert.equal(t.$("campaignName").value, "Campaign 1"); assert.equal(t.$("exportQuality").value, "1080");
    nav.children[1].click(); assert.equal(t.$("campaignName").value, "Brand X"); assert.equal(t.$("exportQuality").value, "720"); assert.equal(t.$("exportSize").textContent, "720 × 1280");
    assert.ok(t.$("campaignPanel").scrolled, "clicking a campaign scrolls to the campaign brief");
    t.$("campaignDelete").click(); saved = JSON.parse(t.mem["clipforge.campaigns.v2"]); assert.equal(saved.campaigns.length, 1);
  } finally { t.restore(); }
});
test("saved campaigns are restored on the next visit", async () => {
  const state = JSON.stringify({ campaigns: [{ id: "c1", name: "Saved one", duration: "45", platform: "TikTok", ratio: "1:1", quality: 480, required: "", prohibited: "", caption: "", brief: "", enabled: true }], activeId: "c1" });
  const t = await bootApp({ storage: { "clipforge.campaigns.v2": state } });
  try { assert.equal(t.$("cfCampaignNav").children.length, 1); assert.equal(t.$("campaignName").value, "Saved one"); assert.equal(t.$("exportQuality").value, "480"); assert.equal(t.$("exportRatio").value, "1:1"); assert.equal(t.$("dashQuality").textContent, "480p"); } finally { t.restore(); }
});
test("export quality and ratio controls update the output size", async () => {
  const t = await bootApp();
  try { for (const [r, q, s] of [["9:16", "480", "480 × 854"], ["9:16", "720", "720 × 1280"], ["16:9", "1080", "1920 × 1080"], ["1:1", "720", "720 × 720"]]) { t.$("exportRatio").value = r; t.$("exportQuality").value = q; t.$("exportQuality").fire("change"); assert.equal(t.$("exportSize").textContent, s); } } finally { t.restore(); }
});
test("link box: YouTube/Twitch/Vimeo show a preview player, bad input and unsupported links explain themselves, direct media needs permission", async () => {
  const t = await bootApp();
  try {
    t.$("sourceUrl").value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"; t.$("previewLink").click();
    assert.equal(t.$("linkPreview").hidden, false); assert.match(t.$("linkPreview").children[0].src, /youtube\.com\/embed\/dQw4w9WgXcQ/); assert.equal(t.$("openLink").disabled, false); assert.match(t.$("linkStatus").textContent, /preview only/);
    t.$("sourceUrl").value = "https://www.twitch.tv/somechannel"; t.$("previewLink").click(); assert.match(t.$("linkPreview").children[0].src, /parent=user\.github\.io/);
    t.$("sourceUrl").value = "https://vimeo.com/123456789"; t.$("previewLink").click(); assert.match(t.$("linkPreview").children[0].src, /player\.vimeo\.com/);
    t.$("sourceUrl").value = "nonsense"; t.$("previewLink").click(); assert.match(t.$("linkStatus").textContent, /not a valid URL/); assert.equal(t.$("linkPreview").hidden, true);
    t.$("sourceUrl").value = "https://example.com/some-page"; t.$("previewLink").click(); assert.match(t.$("linkStatus").textContent, /not a recognised/);
    t.$("sourceUrl").value = "https://cdn.example.com/live/stream.m3u8"; t.$("importRights").checked = false; t.$("previewLink").click(); assert.match(t.$("linkStatus").textContent, /permission box/);
  } finally { t.restore(); }
});
test("file input: non-video files are rejected with a clear message", async () => {
  const t = await bootApp();
  try { t.$("fileInput").fire("change", { target: { files: [{ name: "notes.txt", type: "text/plain", size: 100 }] } }); assert.match(t.$("sourceStatus").textContent, /does not look like a video/); assert.equal(t.$("analyzeBtn").disabled, true); } finally { t.restore(); }
});
test("buttons with no video loaded do nothing harmful and give guidance", async () => {
  const t = await bootApp();
  try {
    await t.$("analyzeBtn").onclick(); t.$("applyTrim").click(); assert.match(t.$("trimStatus").textContent, /Select a moment/);
    await t.$("exportSelected").onclick(); await t.$("exportAll").onclick(); t.$("previewClip").click(); t.$("removeClip").click();
    await t.$("postYoutube").onclick(); assert.match(t.$("postStatus").textContent, /Select a clip first/);
    await t.$("shareClip").onclick(); await t.platformButtons[0].fire("click");
    t.$("startCapture").click(); assert.match(t.$("captureStatus").textContent, /permission box|cannot capture/);
  } finally { t.restore(); }
});
test("rights form validates input, saves records, and drives the dashboard rights indicator", async () => {
  const t = await bootApp();
  try {
    t.$("saveRights").click(); assert.match(t.$("rightsList").textContent, /Enter creator/);
    t.$("creatorName").value = "Creator A"; t.$("evidenceUrl").value = "https://example.com/proof"; t.$("allowedPlatforms").selectedOptions = [{ value: "TikTok" }]; t.$("recordVerified").checked = true; t.$("saveRights").click();
    const rec = JSON.parse(t.mem["clipforge.rights.v2"]); assert.equal(rec[0].status, "approved"); assert.deepEqual(rec[0].platforms, ["TikTok"]);
    assert.equal(t.$("dashRights").textContent, "Not checked"); t.$("rightsConfirm").checked = true; t.$("rightsConfirm").fire("change"); assert.equal(t.$("dashRights").textContent, "Ready");
    t.$("rightsBasis").value = "licensed"; t.$("rightsBasis").fire("change"); assert.equal(t.$("dashRights").textContent, "Not checked"); assert.equal(t.$("rightsRecordWrap").hidden, false);
  } finally { t.restore(); }
});
test("campaign brief analysis fills the form fields", async () => {
  const t = await bootApp();
  try {
    t.$("cfNewCampaign").click(); t.$("campaignBrief").value = "Clip duration: 45 seconds for TikTok in 720p. Use #Launch. Caption: Watch now #Launch"; t.$("parseBrief").click();
    assert.equal(t.$("campaignDuration").value, "45"); assert.equal(t.$("campaignPlatform").value, "TikTok"); assert.equal(t.$("exportQuality").value, "720"); assert.match(t.$("requiredTerms").value, /#Launch/); assert.match(t.$("postCaption").value, /Watch now/); assert.match(t.$("campaignStatus").textContent, /Brief analysed/);
    t.$("campaignBrief").value = ""; t.$("parseBrief").click(); assert.match(t.$("campaignStatus").textContent, /Paste the campaign/);
  } finally { t.restore(); }
});
test("settings save defaults and clear-all wipes saved data", async () => {
  const t = await bootApp();
  try {
    t.$("defQuality").value = "480"; t.$("defRatio").value = "1:1"; t.$("saveSettings").click(); assert.deepEqual(JSON.parse(t.mem["clipforge.settings.v1"]), { quality: "480", ratio: "1:1" }); assert.equal(t.$("exportQuality").value, "480");
    t.$("cfNewCampaign").click(); t.$("clearData").click(); assert.equal(t.mem["clipforge.settings.v1"], undefined); assert.equal(t.mem["clipforge.campaigns.v2"], undefined); assert.match(t.$("cfCampaignNav").children[0].textContent, /No campaigns yet/);
  } finally { t.restore(); }
});
