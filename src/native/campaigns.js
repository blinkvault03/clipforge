/** Multi-campaign store and rule enforcement (pure; storage is injectable). */
import { normalizeQuality } from "./export-settings.js";

export const CAMPAIGNS_KEY = "clipforge.campaigns.v2";
export const LEGACY_PROFILES_KEY = "clipforge.campaigns.v1";

export const parseList = v => String(v ?? "").split(/[,;\n]/).map(x => x.trim()).filter(Boolean);
const newId = () => "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function blankCampaign(name = "New campaign") {
  return { id: newId(), name: String(name).trim().slice(0, 80) || "New campaign", brief: "", duration: "30-60", platform: "YouTube Shorts", ratio: "9:16", quality: 1080, required: "", prohibited: "", caption: "", enabled: true, logoName: "" };
}

export function normalizeCampaign(raw = {}) {
  const b = blankCampaign(raw.name);
  return {
    ...b, id: typeof raw.id === "string" && raw.id ? raw.id : b.id,
    brief: String(raw.brief ?? ""), duration: ["30-60", "30", "45", "60"].includes(raw.duration) ? raw.duration : "30-60",
    platform: String(raw.platform || b.platform), ratio: ["9:16", "1:1", "16:9"].includes(raw.ratio) ? raw.ratio : "9:16",
    quality: normalizeQuality(raw.quality ?? raw.resolution), required: String(raw.required ?? ""), prohibited: String(raw.prohibited ?? ""),
    caption: String(raw.caption ?? ""), enabled: raw.enabled !== false, logoName: String(raw.logoName ?? "")
  };
}

export function durationRange(value) {
  return value === "30-60" ? [30, 60] : [Number(value) || 30, Number(value) || 30];
}

/** Load campaigns, migrating the older single-list profile format once. */
export function loadCampaigns(storage) {
  try {
    const cur = JSON.parse(storage.getItem(CAMPAIGNS_KEY) || "null");
    if (cur && Array.isArray(cur.campaigns)) return { campaigns: cur.campaigns.map(normalizeCampaign), activeId: cur.activeId || null };
    const legacy = JSON.parse(storage.getItem(LEGACY_PROFILES_KEY) || "[]");
    if (Array.isArray(legacy) && legacy.length) {
      const campaigns = legacy.map(normalizeCampaign);
      return { campaigns, activeId: campaigns[0].id };
    }
  } catch { /* corrupt storage: start clean */ }
  return { campaigns: [], activeId: null };
}
export function saveCampaigns(storage, state) {
  storage.setItem(CAMPAIGNS_KEY, JSON.stringify({ campaigns: state.campaigns, activeId: state.activeId }));
}

/** Campaign enforcement for one clip. `clip` = {start,end,quote,title}. */
export function checkClip(campaign, clip, { hasLogo = false } = {}) {
  if (!campaign || !campaign.enabled) return { ok: true, issues: [] };
  const issues = [], [mn, mx] = durationRange(campaign.duration), len = clip.end - clip.start;
  if (len < mn - 0.05 || len > mx + 0.05) issues.push(`Duration must be ${mn === mx ? mn : mn + "–" + mx} seconds.`);
  const text = `${clip.quote || ""} ${clip.title || ""}`.toLowerCase(), caption = String(campaign.caption || "").toLowerCase();
  const missing = parseList(campaign.required).filter(x => x.startsWith("#") ? !caption.includes(x.toLowerCase()) : !text.includes(x.toLowerCase()) && !caption.includes(x.toLowerCase()));
  const banned = parseList(campaign.prohibited).filter(x => text.includes(x.toLowerCase()) || caption.includes(x.toLowerCase()));
  if (missing.length) issues.push("Required terms not found: " + missing.join(", "));
  if (banned.length) issues.push("Prohibited terms detected: " + banned.join(", "));
  const b = String(campaign.brief || "");
  const wantsLogo = /(?:logo|watermark|overlay).{0,35}(?:required|must|mandatory)|(?:required|must include|mandatory).{0,35}(?:logo|watermark|overlay)/i.test(b) && !/(?:no|not|without|optional).{0,20}(?:logo|watermark|overlay)/i.test(b);
  if (wantsLogo && !hasLogo) issues.push("Campaign requires a logo/overlay but none is uploaded.");
  return { ok: !issues.length, issues };
}

/** Rule-based brief reader. Returns the fields it could extract plus review notes. */
export function parseBrief(text) {
  const t = String(text || ""), out = {}, notes = [];
  const d = t.match(/(?:clip|video|duration|length)[^\n\d]{0,25}(30\s*[-–to]{1,3}\s*60|30|45|60)\s*(?:s|sec|seconds)?/i) || t.match(/\b(30\s*[-–]\s*60|30|45|60)\s*(?:s|sec|seconds)\b/i);
  if (d) { const v = d[1].replace(/\s/g, ""); out.duration = /[-–]|to/.test(v) ? "30-60" : v; }
  const plats = [["YouTube Shorts", /youtube\s*shorts/i], ["Instagram Reels", /instagram\s*reels|\breels\b/i], ["TikTok", /tiktok/i], ["X", /twitter|\bX\b/]].filter(([, r]) => r.test(t));
  if (plats.length === 1) out.platform = plats[0][0]; else if (plats.length > 1) notes.push("Multiple platforms mentioned; choose the correct one.");
  if (/1080\s*p/i.test(t)) out.quality = 1080; else if (/720\s*p/i.test(t)) out.quality = 720; else if (/480\s*p/i.test(t)) out.quality = 480;
  if (/9\s*:\s*16|vertical/i.test(t)) out.ratio = "9:16"; else if (/1\s*:\s*1|square/i.test(t)) out.ratio = "1:1"; else if (/16\s*:\s*9|landscape/i.test(t)) out.ratio = "16:9";
  const tags = [...new Set(t.match(/#[A-Za-z0-9_]+/g) || [])];
  if (tags.length) out.requiredTags = tags;
  const banned = t.match(/(?:prohibited|forbidden|do not include|must not include|banned)[\s:]+([^\n.;]+)/i);
  if (banned) out.prohibited = parseList(banned[1]);
  const cap = t.match(/(?:caption|post text)\s*[:\-]\s*([\s\S]{1,400}?)(?:\n\s*\n|$)/i);
  if (cap) out.caption = cap[1].trim();
  if (/music|audio/i.test(t) && /no music|original audio only|music prohibited|copyrighted music prohibited/i.test(t)) notes.push("Audio restriction detected; verify the source audio manually.");
  return { fields: out, notes };
}
