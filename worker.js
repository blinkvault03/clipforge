/**
 * ClipForge Worker V6.4 (Phase 1) — provider-independent API layer.
 * Legacy V6.2 routes are preserved and now run through the provider registry:
 *   GET  /api/health
 *   POST /api/clip-projects       (V6.2 body shape -> ClipJob -> provider.submit)
 *   GET  /api/exportable-clips    (provider.results, raw passthrough)
 * Secrets: OPUS_API_KEY (+ optional OPUS_ORG_ID). Var: ALLOWED_ORIGINS (comma list; unset = "*").
 * Deploy the WHOLE folder (worker.js + src/), not just this file.
 */
import { createDefaultRegistry } from "./src/providers/index.js";
import { legacyToClipJob } from "./src/core/models.js";
import { ProviderError } from "./src/core/contract.js";

const registry = createDefaultRegistry();

function corsFor(request, env) {
  const list = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  let allow = "*";
  if (list.length) allow = list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env) {
    const CORS = corsFor(request, env);
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    let provider;
    try { provider = registry.resolve(); } catch (e) { return json({ error: e.message }, 500); }

    if (url.pathname === "/api/health") {
      return json({ ok: true, provider: provider.id, configured: provider.isConfigured(env), corsLocked: !!(env.ALLOWED_ORIGINS || "").trim() });
    }
    if (!provider.isConfigured(env)) return json({ error: `Backend is not configured. ${provider.configHint}` }, 503);

    try {
      if (url.pathname === "/api/clip-projects" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) || {};
        if (!body.videoUrl || !/^https:\/\//i.test(body.videoUrl)) return json({ error: "A valid HTTPS videoUrl is required." }, 400);
        const r = await provider.submit(legacyToClipJob(body), env);
        return json(r.raw, r.httpStatus);
      }
      if (url.pathname === "/api/exportable-clips" && request.method === "GET") {
        const projectId = url.searchParams.get("projectId");
        if (!projectId) return json({ error: "projectId is required." }, 400);
        const r = await provider.results(projectId, env);
        return json(r.raw, r.httpStatus);
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      const status = e instanceof ProviderError && e.httpStatus ? e.httpStatus : 502;
      return json({ error: e.message || "Upstream request failed" }, status);
    }
  }
};
