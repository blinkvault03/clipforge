/**
 * Source-link recognition for ClipForge.
 *
 * A pasted link is classified so the UI can show the right embedded PREVIEW or
 * route a direct media file to the importer. Recognising a platform link never
 * downloads anything: YouTube, Twitch, Vimeo and Kick pages are preview-only.
 * To clip them the creator supplies an authorised recording (file upload,
 * direct media URL, HLS playlist or screen/tab capture).
 */

const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|flv|wmv|ts|mts|m2ts|3gp|mpg|mpeg|ogv)$/i;
const HLS_EXT = /\.m3u8$/i;

const hostOf = u => u.hostname.toLowerCase().replace(/^(www|m|player|clips|go)\./, "");

export function parseYouTube(u) {
  const host = hostOf(u);
  const parts = u.pathname.split("/").filter(Boolean);
  let id = null;
  let kind = "video";
  if (host === "youtu.be") id = parts[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (parts[0] === "live") { id = parts[1]; kind = "live"; }
    else if (parts[0] === "shorts" || parts[0] === "embed") id = parts[1];
    else id = u.searchParams.get("v");
  } else return null;
  return id && YT_ID.test(id) ? { platform: "youtube", kind, id } : null;
}

export function parseTwitch(u) {
  const host = hostOf(u);
  if (u.hostname.toLowerCase() === "clips.twitch.tv") {
    const slug = u.pathname.split("/").filter(Boolean)[0];
    return slug ? { platform: "twitch", kind: "clip", id: slug } : null;
  }
  if (host !== "twitch.tv") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  if (parts[0] === "videos" && /^\d+$/.test(parts[1] || "")) return { platform: "twitch", kind: "vod", id: parts[1] };
  if (parts[1] === "clip" && parts[2]) return { platform: "twitch", kind: "clip", id: parts[2] };
  if (parts[0] && /^[A-Za-z0-9_]{3,25}$/.test(parts[0]) && !["videos", "directory", "downloads", "p", "settings"].includes(parts[0].toLowerCase()))
    return { platform: "twitch", kind: "live", id: parts[0].toLowerCase() };
  return null;
}

export function parseVimeo(u) {
  const host = hostOf(u);
  if (host !== "vimeo.com") return null;
  const id = u.pathname.split("/").filter(Boolean).find(p => /^\d{5,}$/.test(p));
  return id ? { platform: "vimeo", kind: "video", id } : null;
}

export function parseKick(u) {
  if (hostOf(u) !== "kick.com") return null;
  const parts = u.pathname.split("/").filter(Boolean);
  return parts[0] && /^[A-Za-z0-9_-]{2,40}$/.test(parts[0]) ? { platform: "kick", kind: "live", id: parts[0] } : null;
}

/** Classify any pasted link. Returns {platform, kind, id?, url} or {platform:"invalid"|"unsupported"}. */
export function classifySource(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { platform: "invalid", reason: "Paste a link first." };
  let u;
  try { u = new URL(text); } catch { return { platform: "invalid", reason: "That is not a valid URL." }; }
  if (!/^https?:$/.test(u.protocol)) return { platform: "invalid", reason: "Only http(s) links are supported." };
  const found = parseYouTube(u) || parseTwitch(u) || parseVimeo(u) || parseKick(u);
  if (found) return { ...found, url: u.toString() };
  if (HLS_EXT.test(u.pathname)) return { platform: "hls", kind: "stream", url: u.toString() };
  if (VIDEO_EXT.test(u.pathname)) return { platform: "direct", kind: "file", url: u.toString() };
  return { platform: "unsupported", url: u.toString(), reason: "This link is not a recognised video page or direct media file." };
}

/** Embeddable preview URL, or null when the platform has no safe embed. `parentHost` is required by Twitch. */
export function embedUrl(src, parentHost = "localhost") {
  const parent = encodeURIComponent(parentHost);
  switch (src?.platform) {
    case "youtube": return `https://www.youtube.com/embed/${src.id}?rel=0&playsinline=1`;
    case "twitch":
      if (src.kind === "live") return `https://player.twitch.tv/?channel=${encodeURIComponent(src.id)}&parent=${parent}&autoplay=false`;
      if (src.kind === "vod") return `https://player.twitch.tv/?video=v${encodeURIComponent(src.id)}&parent=${parent}&autoplay=false`;
      return `https://clips.twitch.tv/embed?clip=${encodeURIComponent(src.id)}&parent=${parent}&autoplay=false`;
    case "vimeo": return `https://player.vimeo.com/video/${src.id}`;
    default: return null;
  }
}

export const PLATFORM_LABEL = { youtube: "YouTube", twitch: "Twitch", vimeo: "Vimeo", kick: "Kick", hls: "HLS stream", direct: "Direct video file" };

/** Platform links give preview/metadata only; only these can be imported as media bytes. */
export const isImportable = src => src?.platform === "direct" || src?.platform === "hls";
