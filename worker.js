
/**
 * ClipForge Worker V6.5
 * Provider selection is explicit and environment-driven.
 * No paid or third-party provider is selected implicitly.
 */

import { createDefaultRegistry } from "./src/providers/index.js";
import { legacyToClipJob } from "./src/core/models.js";
import { ProviderError } from "./src/core/contract.js";

function corsFor(request, env) {
  const list = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const origin = request.headers.get("Origin") || "";

  // Fail closed when no allowlist is configured.
  let allow = "";
  if (list.length && list.includes(origin)) {
    allow = origin;
  }

  return {
    ...(allow ? { "Access-Control-Allow-Origin": allow } : {}),
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };
}

export default {
  async fetch(request, env) {
    const CORS = corsFor(request, env);

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: {
          ...CORS,
          "Content-Type": "application/json"
        }
      });

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    let registry;
    try {
      registry = createDefaultRegistry(env);
    } catch (error) {
      return json({
        ok: false,
        error: error.message,
        code: "INVALID_PROVIDER_CONFIGURATION"
      }, 500);
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      const providers = await Promise.all(
        registry.list().map(async provider => ({
          id: provider.id,
          label: provider.label,
          cost: provider.cost,
          dataFlow: provider.dataFlow,
          configured: provider.isConfigured(env),
          health: await provider.health(env)
        }))
      );

      return json({
        ok: true,
        defaultProvider: registry.defaultId(),
        providers,
        corsLocked: !!(env.ALLOWED_ORIGINS || "").trim()
      });
    }

    let provider;
    try {
      provider = registry.resolve();
    } catch {
      return json({
        ok: false,
        error: "No default provider is configured. Enable a provider and set DEFAULT_PROVIDER explicitly.",
        code: "NO_DEFAULT_PROVIDER"
      }, 503);
    }

    if (!provider.isConfigured(env)) {
      return json({
        ok: false,
        error: `Provider is not configured. ${provider.configHint || ""}`,
        code: "PROVIDER_NOT_CONFIGURED"
      }, 503);
    }

    try {
      if (url.pathname === "/api/clip-projects" && request.method === "POST") {
        const body = (await request.json().catch(() => ({}))) || {};

        if (
          !body.videoUrl ||
          !/^https:\/\//i.test(body.videoUrl)
        ) {
          return json({
            error: "A valid HTTPS videoUrl is required."
          }, 400);
        }

        const result = await provider.submit(
          legacyToClipJob(body),
          env
        );

        return json(result.raw, result.httpStatus);
      }

      if (
        url.pathname === "/api/exportable-clips" &&
        request.method === "GET"
      ) {
        const projectId = url.searchParams.get("projectId");

        if (!projectId) {
          return json({ error: "projectId is required." }, 400);
        }

        const result = await provider.results(projectId, env);

        return json(result.raw, result.httpStatus);
      }

      return json({ error: "Not found" }, 404);

    } catch (error) {
      const status =
        error instanceof ProviderError && error.httpStatus
          ? error.httpStatus
          : 502;

      return json({
        error: error.message || "Provider request failed",
        code: error.code || "PROVIDER_ERROR"
      }, status);
    }
  }
};
