// Verbatim copy of the V6.3 Worker's sanitizeProject(): the "no behaviour change" reference.
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
export function sanitizeProject(body) {
  const cur = body.curationPref || {};
  const durs = Array.isArray(cur.clipDurations) ? cur.clipDurations.slice(0, 4) : [[30, 60]];
  const out = {
    videoUrl: String(body.videoUrl),
    curationPref: {
      clipDurations: durs.map(p => [num(p?.[0], 30), num(p?.[1], 60)]),
      genre: typeof cur.genre === "string" ? cur.genre.slice(0, 60) : undefined,
      skipCurate: !!cur.skipCurate,
      customPrompt: typeof cur.customPrompt === "string" ? cur.customPrompt.slice(0, 500) : undefined
    },
    importPref: { sourceLang: typeof body.importPref?.sourceLang === "string" ? body.importPref.sourceLang.slice(0, 12) : "auto" },
    renderPref: { layoutAspectRatio: body.renderPref?.layoutAspectRatio === "landscape" ? "landscape" : "portrait" }
  };
  return out;
}
