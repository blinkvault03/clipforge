/**
 * Posting clips.
 *
 *  - YouTube (Shorts or regular): REAL direct upload from the browser via the YouTube Data API
 *    resumable-upload protocol, using the creator's own OAuth token (scope youtube.upload).
 *  - TikTok / Instagram / X / others: these platforms only allow posting through approved, server-side
 *    developer apps, so a static site cannot post for you. ClipForge uses the system share sheet
 *    (Web Share API with the MP4 attached, ideal on phones) or opens the platform's own upload page
 *    after downloading the clip and copying the caption.
 */

export const YT_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YT_UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export const PLATFORMS = Object.freeze({
  "YouTube Shorts": { direct: true, uploadPage: "https://www.youtube.com/upload", maxSeconds: 180 },
  "Instagram Reels": { direct: false, uploadPage: "https://www.instagram.com/", maxSeconds: 90 },
  "TikTok": { direct: false, uploadPage: "https://www.tiktok.com/upload", maxSeconds: 600 },
  "X": { direct: false, uploadPage: "https://x.com/compose/post", maxSeconds: 140 }
});

/** Split a caption into a title (first line, max 100 chars) and description; ensures #Shorts for vertical clips. */
export function buildYoutubeMetadata({ title = "", caption = "", ratio = "9:16", privacy = "private", shorts = true } = {}) {
  const lines = String(caption).split(/\n/);
  let t = String(title || lines[0] || "ClipForge clip").replace(/[<>]/g, "").trim();
  const wantsShorts = shorts && ratio === "9:16";
  if (wantsShorts && !/#shorts/i.test(t + caption)) t = `${t.slice(0, 90)} #Shorts`;
  t = t.slice(0, 100) || "ClipForge clip";
  const description = (String(caption).replace(/[<>]/g, "") + (wantsShorts && !/#shorts/i.test(caption) ? "\n\n#Shorts" : "")).slice(0, 4900);
  return { snippet: { title: t, description, categoryId: "22" }, status: { privacyStatus: ["private", "unlisted", "public"].includes(privacy) ? privacy : "private", selfDeclaredMadeForKids: false } };
}

/**
 * Resumable upload to YouTube. `blob` is the MP4. Returns {id, url}.
 * Throws Error with a user-readable message on failure. fetchImpl injectable for tests.
 */
export async function uploadToYouTube({ blob, accessToken, metadata, fetchImpl = globalThis.fetch, onProgress }) {
  if (!accessToken) throw new Error("Connect YouTube with upload permission first.");
  if (!blob || !blob.size) throw new Error("Export a clip first; there is no MP4 to upload.");
  const start = await fetchImpl(YT_UPLOAD_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(blob.size) },
    body: JSON.stringify(metadata)
  });
  if (!start.ok) throw new Error(await explain(start, "YouTube did not accept the upload request"));
  const location = start.headers.get("Location");
  if (!location) throw new Error("YouTube returned no upload location. Check that the YouTube Data API v3 is enabled and the account has a channel.");
  const put = await fetchImpl(location, { method: "PUT", headers: { "Content-Type": "video/mp4" }, body: blob });
  if (!put.ok) throw new Error(await explain(put, "YouTube rejected the video data"));
  const data = await put.json().catch(() => ({}));
  if (!data.id) throw new Error("Upload finished but YouTube returned no video ID.");
  onProgress?.(1);
  return { id: data.id, url: `https://www.youtube.com/watch?v=${data.id}` };
}

async function explain(res, prefix) {
  let detail = "";
  try { detail = (await res.json())?.error?.message || ""; } catch { /* non-JSON error body */ }
  const hint = res.status === 401 ? " Your sign-in expired; connect again." : res.status === 403 ? " The account may lack upload permission or API quota." : "";
  return `${prefix} (HTTP ${res.status}${detail ? ": " + detail : ""}).${hint}`;
}

/** Can this browser share a file via the native share sheet? */
export function canShareFile(nav, file) {
  try { return !!(nav && typeof nav.canShare === "function" && typeof nav.share === "function" && nav.canShare({ files: [file] })); } catch { return false; }
}

/** Human guidance for platforms without direct posting. */
export function manualPostSteps(platform) {
  const p = PLATFORMS[platform];
  if (!p) return "Download the clip and upload it on the platform.";
  return `${platform} does not allow posting from a static website. Use “Share…” (phones) or download the MP4, copy the caption and open ${platform}’s upload page.`;
}
