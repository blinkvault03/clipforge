/**
 * Captions: SRT export and ASS generation (hard-burned by FFmpeg/libass).
 * Includes the hook/title overlay so title text is rendered by the same engine.
 */

export const CAPTION_SIZES = Object.freeze({ small: 0.024, medium: 0.03, large: 0.038 });
export const CAPTION_POSITIONS = Object.freeze({ bottom: { align: 2, margin: 0.085 }, center: { align: 5, margin: 0 }, top: { align: 8, margin: 0.12 } });
export const DEFAULT_CAPTION_STYLE = Object.freeze({ size: "medium", position: "bottom", uppercase: false, words: 6 });

const pad = (n, w = 2) => String(n).padStart(w, "0");

export function srtTime(sec) {
  const ms = Math.max(0, Math.round(sec * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(Math.floor((ms % 60000) / 1000))},${pad(ms % 1000, 3)}`;
}
export function assTime(sec) {
  const cs = Math.max(0, Math.round(sec * 100));
  return `${Math.floor(cs / 360000)}:${pad(Math.floor((cs % 360000) / 6000))}:${pad(Math.floor((cs % 6000) / 100))}.${pad(cs % 100)}`;
}
export function assEscape(text) {
  return String(text ?? "").replace(/\\/g, "\\\\").replace(/{/g, "(").replace(/}/g, ")").replace(/\r?\n/g, " ");
}

/** Cut transcript chunks to the clip window and split into short, readable cues (times relative to clip start). */
export function buildCues(transcript, a, b, style = {}) {
  const per = Math.max(2, Math.min(10, Number(style.words) || DEFAULT_CAPTION_STYLE.words));
  const cues = [];
  const list = (transcript || []).filter(c => Array.isArray(c.timestamp) && Number.isFinite(c.timestamp[0]));
  list.forEach((c, ci) => {
    const nextStart = list[ci + 1]?.timestamp?.[0];
    const rawEnd = Number.isFinite(c.timestamp[1]) ? c.timestamp[1] : (Number.isFinite(nextStart) ? nextStart : c.timestamp[0] + 3);
    const start = Math.max(a, c.timestamp[0]), end = Math.min(b, rawEnd);
    if (end <= start) return;
    const ws = String(c.text || "").match(/\S+/g) || [];
    if (!ws.length) return;
    const groups = [];
    for (let i = 0; i < ws.length; i += per) groups.push(ws.slice(i, i + per));
    groups.forEach((g, i) => {
      const t0 = start + (end - start) * (i / groups.length), t1 = start + (end - start) * ((i + 1) / groups.length);
      if (t1 > t0) cues.push({ start: t0 - a, end: t1 - a, text: g.join(" "), source: ci });
    });
  });
  return cues;
}

export function makeSrt(cues) {
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

/**
 * ASS document. `hook` (optional string) is shown as a title overlay for `hookSeconds` at the top.
 * Fontname defaults to Arial, which ClipForge ships to FFmpeg's font directory at export time.
 */
export function makeAss(cues, width, height, { style = {}, hook = "", hookSeconds = 3, fontName = "Arial" } = {}) {
  if (!cues.length && !hook) throw new Error("No timed captions are available. Run AI analysis first, or turn burned-in captions off.");
  const st = { ...DEFAULT_CAPTION_STYLE, ...style };
  const size = Math.round(height * (CAPTION_SIZES[st.size] || CAPTION_SIZES.medium));
  const pos = CAPTION_POSITIONS[st.position] || CAPTION_POSITIONS.bottom;
  const marginV = Math.round(height * pos.margin);
  const hookSize = Math.round(height * 0.04);
  const text = t => { const s = assEscape(t); return st.uppercase ? s.toUpperCase() : s; };
  const lines = cues.map(c => {
    const words = text(c.text).split(" ");
    const split = Math.ceil(words.length / 2);
    const body = words.length > 3 ? words.slice(0, split).join(" ") + "\\N" + words.slice(split).join(" ") : words.join(" ");
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${body}`;
  });
  if (hook) lines.push(`Dialogue: 1,${assTime(0)},${assTime(hookSeconds)},Hook,,0,0,0,,${assEscape(hook).toUpperCase()}`);
  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${fontName},${size},&H00FFFFFF,&H0000FFFF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,4,1,${pos.align},60,60,${marginV},1`,
    `Style: Hook,${fontName},${hookSize},&H0000E6FF,&H0000FFFF,&H00101010,&H99000000,-1,0,0,0,100,100,0,0,1,5,1,8,60,60,${Math.round(height * 0.07)},1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...lines, ""
  ].join("\n");
}
