/**
 * Video input validation and format handling.
 *
 * ClipForge accepts any video container FFmpeg can read. The browser <video>
 * element only plays some of them natively (MP4/H.264, WebM/VP8-VP9, often MOV);
 * everything else (MKV, AVI, FLV, WMV, TS, 3GP, MPEG ...) is transcoded once to
 * an MP4 preview proxy so it can be previewed, trimmed and analysed.
 */

export const VIDEO_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "mkv", "avi", "flv", "wmv", "ts", "mts", "m2ts", "3gp", "3g2", "mpg", "mpeg", "ogv", "asf", "f4v", "vob", "mxf"];
export const NATIVE_PLAYABLE_EXTENSIONS = ["mp4", "m4v", "mov", "webm", "ogv"];
export const MIN_ANALYSIS_SECONDS = 30;
export const SOFT_LIMIT_BYTES = 1024 ** 3;          // warn above 1 GB
export const HARD_LIMIT_BYTES = 2 * 1024 ** 3 - 1;  // FFmpeg.wasm virtual file system limit (~2 GB)

export const ACCEPT_ATTRIBUTE = "video/*," + VIDEO_EXTENSIONS.map(e => "." + e).join(",");

export function extensionOf(name = "") {
  const m = /\.([A-Za-z0-9]{1,5})$/.exec(String(name));
  return m ? m[1].toLowerCase() : "";
}

/** A safe extension to use for FFmpeg's virtual file system. */
export function safeExtension(name = "", type = "") {
  const ext = extensionOf(name);
  if (VIDEO_EXTENSIONS.includes(ext)) return ext;
  if (/webm/.test(type)) return "webm";
  if (/quicktime/.test(type)) return "mov";
  if (/matroska/.test(type)) return "mkv";
  return "mp4";
}

/**
 * Validate a chosen file. Returns {ok, error?, warnings[], needsProxy}.
 * `file` only needs {name, type, size}, so this is testable without a browser.
 */
export function validateVideoFile(file) {
  const warnings = [];
  if (!file || typeof file !== "object") return { ok: false, error: "No file selected.", warnings, needsProxy: false };
  const ext = extensionOf(file.name);
  const isVideoMime = typeof file.type === "string" && file.type.startsWith("video/");
  const knownExt = VIDEO_EXTENSIONS.includes(ext);
  if (!isVideoMime && !knownExt) {
    return { ok: false, error: `“${file.name || "This file"}” does not look like a video. Supported: ${VIDEO_EXTENSIONS.slice(0, 12).join(", ").toUpperCase()} and more.`, warnings, needsProxy: false };
  }
  if (!(file.size > 0)) return { ok: false, error: "This file is empty.", warnings, needsProxy: false };
  if (file.size > HARD_LIMIT_BYTES) {
    return { ok: false, error: "This file is larger than 2 GB, which the in-browser FFmpeg engine cannot hold. Trim or compress it first (for example with a 720p export from your recorder).", warnings, needsProxy: false };
  }
  if (file.size > SOFT_LIMIT_BYTES) warnings.push("Large file: analysis and export need plenty of free memory and may be slow.");
  const needsProxy = !NATIVE_PLAYABLE_EXTENSIONS.includes(ext) && !/^video\/(mp4|webm|quicktime|ogg)$/.test(file.type || "");
  if (needsProxy) warnings.push(`.${ext || "this format"} is not playable in most browsers; a preview copy will be created automatically.`);
  return { ok: true, warnings, needsProxy };
}

/** Parse an FFmpeg log line such as "  Duration: 00:01:23.45, start: ..." into seconds. */
export function parseFfmpegDuration(line) {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(String(line));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

/** Validate a direct-media/HLS URL before the browser tries to fetch it. */
export function validateMediaUrl(raw) {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return { ok: false, error: "Paste a direct video or .m3u8 URL." };
  if (text.length > 2048) return { ok: false, error: "URL is too long." };
  let u;
  try { u = new URL(text); } catch { return { ok: false, error: "Not a valid URL." }; }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))) {
    return { ok: false, error: "Use an HTTPS URL (the page itself is served over HTTPS, so HTTP media would be blocked)." };
  }
  if (u.username || u.password) return { ok: false, error: "URLs with embedded credentials are not allowed." };
  return { ok: true, url: u.toString() };
}
