import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker.js";
import { sanitizeProject } from "./fixtures/legacy_v63.js";

const realFetch = globalThis.fetch;
let calls;

const stub = (impl) => {
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return impl(url, options);
  };
};

test.afterEach(() => {
  globalThis.fetch = realFetch;
});

const call = (
  env,
  path,
  { method = "GET", body, origin = "https://me.github.io" } = {}
) =>
  worker.fetch(
    new Request(`https://x.workers.dev${path}`, {
      method,
      headers: { Origin: origin },
      body:
        body === undefined
          ? undefined
          : typeof body === "string"
            ? body
            : JSON.stringify(body)
    }),
    env
  );

// OpusClip is enabled explicitly for legacy compatibility tests.
const OK = {
  OPUS_API_KEY: "k",
  ENABLE_OPUSCLIP_PROVIDER: "true",
  DEFAULT_PROVIDER: "opusclip"
};

test("health reports no provider when none is explicitly enabled", async () => {
  const response = await call({}, "/api/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true,
    defaultProvider: null,
    providers: [],
    corsLocked: false
  });
});

test("health reports explicitly enabled OpusClip provider", async () => {
  const response = await call(OK, "/api/health");
  const data = await response.json();

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.defaultProvider, "opusclip");
  assert.equal(data.providers.length, 1);
  assert.equal(data.providers[0].id, "opusclip");
  assert.equal(data.providers[0].cost, "paid");
  assert.equal(data.providers[0].dataFlow, "third-party");
  assert.equal(data.providers[0].configured, true);
  assert.equal(data.providers[0].health.status, "available");
});

test("non-health routes return 503 when no provider is selected", async () => {
  for (const [path, method] of [
    ["/api/clip-projects", "POST"],
    ["/api/exportable-clips?projectId=1", "GET"],
    ["/api/nope", "GET"]
  ]) {
    const response = await call({}, path, {
      method,
      body: method === "POST" ? {} : undefined
    });

    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, "NO_DEFAULT_PROVIDER");
  }
});

test("invalid provider configuration returns 500", async () => {
  const response = await call(
    { DEFAULT_PROVIDER: "opusclip" },
    "/api/health"
  );

  assert.equal(response.status, 500);
  assert.equal(
    (await response.json()).code,
    "INVALID_PROVIDER_CONFIGURATION"
  );
});

test("enabled but unconfigured provider returns 503 on processing routes", async () => {
  const env = {
    ENABLE_OPUSCLIP_PROVIDER: "true",
    DEFAULT_PROVIDER: "opusclip"
  };

  const response = await call(env, "/api/clip-projects", {
    method: "POST",
    body: { videoUrl: "https://youtu.be/abc" }
  });

  assert.equal(response.status, 503);
  assert.equal(
    (await response.json()).code,
    "PROVIDER_NOT_CONFIGURED"
  );
});

test("POST /api/clip-projects forwards the legacy request and upstream status", async () => {
  const body = {
    videoUrl: "https://youtu.be/abc",
    curationPref: {
      clipDurations: [[30, 60]],
      genre: "Auto",
      customPrompt: "x",
      evil: 1
    },
    importPref: { sourceLang: "auto" },
    renderPref: { layoutAspectRatio: "portrait" },
    admin: true
  };

  stub(() =>
    new Response(JSON.stringify({ projectId: "p1" }), {
      status: 201
    })
  );

  const response = await call(OK, "/api/clip-projects", {
    method: "POST",
    body
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { projectId: "p1" });
  assert.equal(
    calls[0].url,
    "https://api.opus.pro/api/clip-projects"
  );
  assert.equal(
    calls[0].options.body,
    JSON.stringify(sanitizeProject(body))
  );
  assert.equal(calls[0].options.headers.Authorization, "Bearer k");
});

test("input validation rejects invalid video URLs and malformed JSON", async () => {
  stub(() => {
    throw new Error("should not be called");
  });

  for (const body of [
    { videoUrl: "http://a.com" },
    {},
    "not json",
    "null",
    "[]"
  ]) {
    const response = await call(OK, "/api/clip-projects", {
      method: "POST",
      body
    });

    assert.equal(response.status, 400);
  }

  assert.equal(calls.length, 0);
});

test("upstream provider failure status is passed through", async () => {
  stub(() =>
    new Response(JSON.stringify({ error: "no credits" }), {
      status: 402
    })
  );

  const response = await call(OK, "/api/clip-projects", {
    method: "POST",
    body: { videoUrl: "https://a.com/v" }
  });

  assert.equal(response.status, 402);
  assert.equal((await response.json()).error, "no credits");
});

test("network failure returns 502 and health remains available", async () => {
  stub(() => {
    throw new Error("ECONNRESET");
  });

  const response = await call(OK, "/api/clip-projects", {
    method: "POST",
    body: { videoUrl: "https://a.com/v" }
  });

  assert.equal(response.status, 502);
  assert.equal((await response.json()).error, "ECONNRESET");
  assert.equal((await call(OK, "/api/health")).status, 200);
});

test("GET /api/exportable-clips passes through results and org ID", async () => {
  stub(() =>
    new Response(JSON.stringify({ clips: [{ id: "c" }] }), {
      status: 200
    })
  );

  const env = { ...OK, OPUS_ORG_ID: "org" };
  const response = await call(
    env,
    "/api/exportable-clips?projectId=p1"
  );

  assert.deepEqual(await response.json(), {
    clips: [{ id: "c" }]
  });

  assert.equal(
    calls[0].url,
    "https://api.opus.pro/api/exportable-clips?q=findByProjectId&projectId=p1"
  );
  assert.equal(calls[0].options.headers["x-opus-org-id"], "org");

  const missing = await call(OK, "/api/exportable-clips");
  assert.equal(missing.status, 400);
});

test("unknown routes, wrong methods and OPTIONS are handled", async () => {
  assert.equal((await call(OK, "/api/nope")).status, 404);

  assert.equal(
    (await call(OK, "/api/clip-projects", {
      method: "GET"
    })).status,
    404
  );

  const preflight = await call(OK, "/api/clip-projects", {
    method: "OPTIONS"
  });

  assert.equal(preflight.status, 204);
  assert.match(
    preflight.headers.get("access-control-allow-methods"),
    /POST/
  );
});

test("CORS only allows origins explicitly listed", async () => {
  const locked = {
    ...OK,
    ALLOWED_ORIGINS: "https://me.github.io, https://b.com"
  };

  const allowed = await call(locked, "/api/health", {
    origin: "https://b.com"
  });

  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "https://b.com"
  );

  const blocked = await call(locked, "/api/health", {
    origin: "https://evil.com"
  });

  assert.equal(
    blocked.headers.get("access-control-allow-origin"),
    null
  );

  const unlocked = await call(OK, "/api/health", {
    origin: "https://evil.com"
  });

  assert.equal(
    unlocked.headers.get("access-control-allow-origin"),
    null
  );

  assert.equal(
    (await (await call(locked, "/api/health")).json()).corsLocked,
    true
  );
});
