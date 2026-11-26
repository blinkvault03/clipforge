/** Export presets and FFmpeg argument building (pure, so it can be tested with a native FFmpeg). */

export const QUALITY_PRESETS = Object.freeze({
  480: { height: 480, crf: 26, preset: "ultrafast", label: "480p (small, fastest)" },
  720: { height: 720, crf: 24, preset: "ultrafast", label: "720p (balanced)" },
  1080: { height: 1080, crf: 22, preset: "veryfast", label: "1080p (best quality)" }
});
export const ASPECT_RATIOS = Object.freeze(["9:16", "1:1", "16:9"]);

export function normalizeQuality(q) {
  const n = Number(q);
  return QUALITY_PRESETS[n] ? n : 1080;
}

const even = n => Math.max(2, Math.round(n / 2) * 2);

/** Output dimensions. `quality` is the SHORT-side-independent "height class": 9:16 => 720 means 720x1280. */
export function outputSize(ratio, quality) {
  const q = normalizeQuality(quality);
  switch (ratio) {
    case "1:1": return { width: q, height: q };
    case "16:9": return { width: even(q * 16 / 9), height: q };
    default: return { width: q, height: even(q * 16 / 9) }; // 9:16 vertical
  }
}

export function videoFilter(ratio, { width, height }) {
  if (ratio === "16:9") return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`;
  if (ratio === "1:1") return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
}

/**
 * Build the FFmpeg argument list for one clip.
 * opts: {input, output, start, end, ratio, quality, assFile?, logoFile?, fontsDir?}
 */
export function buildExportArgs({ input, output, start, end, ratio = "9:16", quality = 1080, assFile, logoFile, fontsDir }) {
  if (!(end > start)) throw new Error("Clip end must be after its start.");
  const q = normalizeQuality(quality), size = outputSize(ratio, q), preset = QUALITY_PRESETS[q];
  const vf = videoFilter(ratio, size);
  const subs = assFile ? `subtitles=${assFile}${fontsDir ? `:fontsdir=${fontsDir}` : ""}` : "";
  const args = ["-ss", String(start), "-i", input, "-t", String(end - start)];
  if (logoFile) {
    args.push("-loop", "1", "-i", logoFile, "-filter_complex",
      `[0:v]${vf}[base];[1:v]scale=${Math.round(size.width * 0.17)}:-1[logo];[base][logo]overlay=W-w-24:24[branded]${subs ? `;[branded]${subs}[outv]` : ";[branded]null[outv]"}`,
      "-map", "[outv]", "-map", "0:a:0?", "-shortest");
  } else {
    args.push("-vf", subs ? `${vf},${subs}` : vf, "-map", "0:v:0", "-map", "0:a:0?");
  }
  args.push("-c:v", "libx264", "-preset", preset.preset, "-crf", String(preset.crf), "-r", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", output);
  return args;
}
