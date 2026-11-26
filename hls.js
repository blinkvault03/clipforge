/**
 * Minimal HLS (.m3u8) support for creator-authorised streams and live windows.
 * Only unencrypted playlists are supported: ClipForge never circumvents DRM or
 * encryption. Fetching is injectable so the logic can be tested offline.
 */

export class HlsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const resolve = (base, ref) => new URL(ref, base).toString();

/** Parse a playlist. Returns {type:"master"|"media", variants|segments, live, encrypted}. */
export function parsePlaylist(text, baseUrl) {
  const lines = String(text).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new HlsError("NOT_HLS", "This URL is not a valid HLS playlist.");
  if (lines.some(l => /^#EXT-X-STREAM-INF/.test(l))) {
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/^#EXT-X-STREAM-INF/.test(lines[i])) continue;
      const bw = Number(/BANDWIDTH=(\d+)/.exec(lines[i])?.[1] || 0);
      const res = /RESOLUTION=(\d+)x(\d+)/.exec(lines[i]);
      const uri = lines[i + 1];
      if (uri && !uri.startsWith("#")) variants.push({ url: resolve(baseUrl, uri), bandwidth: bw, height: res ? Number(res[2]) : null });
    }
    return { type: "master", variants };
  }
  const encrypted = lines.some(l => /^#EXT-X-KEY:/.test(l) && !/METHOD=NONE/.test(l));
  const segments = [];
  let duration = 0;
  for (let i = 0; i < lines.length; i++) {
    const inf = /^#EXTINF:([\d.]+)/.exec(lines[i]);
    if (inf) { duration = Number(inf[1]); continue; }
    if (!lines[i].startsWith("#") && duration > 0) { segments.push({ url: resolve(baseUrl, lines[i]), duration }); duration = 0; }
  }
  const init = /^#EXT-X-MAP:.*URI="([^"]+)"/.exec(lines.find(l => l.startsWith("#EXT-X-MAP:")) || "");
  return {
    type: "media", segments, encrypted,
    live: !lines.includes("#EXT-X-ENDLIST"),
    initUrl: init ? resolve(baseUrl, init[1]) : null,
    totalSeconds: segments.reduce((s, x) => s + x.duration, 0)
  };
}

/** Pick the variant closest to (but not above) a target height; falls back to the lowest. */
export function pickVariant(variants, maxHeight = 720) {
  if (!variants.length) return null;
  const withH = variants.filter(v => v.height);
  const ok = withH.filter(v => v.height <= maxHeight).sort((a, b) => b.height - a.height);
  if (ok.length) return ok[0];
  return [...variants].sort((a, b) => (a.height || a.bandwidth) - (b.height || b.bandwidth))[0];
}

/**
 * Download an authorised HLS stream (or the live window available right now) into one Blob.
 * Options: maxSeconds (default 3600), fetchImpl, onProgress(done,total), signal.
 */
export async function downloadHls(url, { maxSeconds = 3600, maxHeight = 720, fetchImpl = globalThis.fetch, onProgress, signal } = {}) {
  const getText = async u => {
    const r = await fetchImpl(u, { signal });
    if (!r.ok) throw new HlsError("HTTP", `The host returned HTTP ${r.status}.`);
    return r.text();
  };
  let media = parsePlaylist(await getText(url), url);
  if (media.type === "master") {
    const v = pickVariant(media.variants, maxHeight);
    if (!v) throw new HlsError("NO_VARIANTS", "The playlist lists no playable streams.");
    media = parsePlaylist(await getText(v.url), v.url);
  }
  if (media.encrypted) throw new HlsError("ENCRYPTED", "This stream is encrypted. ClipForge does not bypass encryption or DRM; use a recording you are authorised to edit.");
  if (!media.segments.length) throw new HlsError("EMPTY", "The playlist has no media segments yet.");
  const segments = [];
  let acc = 0;
  for (const s of media.segments) { if (acc >= maxSeconds) break; segments.push(s); acc += s.duration; }
  const parts = [];
  if (media.initUrl) {
    const r = await fetchImpl(media.initUrl, { signal });
    if (!r.ok) throw new HlsError("HTTP", `Init segment returned HTTP ${r.status}.`);
    parts.push(await r.arrayBuffer());
  }
  for (let i = 0; i < segments.length; i++) {
    const r = await fetchImpl(segments[i].url, { signal });
    if (!r.ok) throw new HlsError("HTTP", `Segment ${i + 1} returned HTTP ${r.status}.`);
    parts.push(await r.arrayBuffer());
    onProgress?.(i + 1, segments.length);
  }
  return { parts, seconds: acc, live: media.live, fragmented: !!media.initUrl };
}
