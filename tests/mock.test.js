
import test from "node:test";
import assert from "node:assert/strict";

import { mock } from "../src/providers/mock.js";
import {
  assertProvider,
  ProviderError,
  ERROR_CODES
} from "../src/core/contract.js";

test("mock provider satisfies the provider contract", () => {
  assert.doesNotThrow(() => assertProvider(mock));
  assert.equal(mock.id, "mock");
  assert.equal(mock.cost, "free");
  assert.equal(mock.dataFlow, "local");
  assert.equal(mock.requiresCredentials, false);
});

test("mock provider is disabled unless explicitly enabled", async () => {
  assert.equal(mock.isConfigured({}), false);

  const health = await mock.health({});
  assert.equal(health.status, "unconfigured");

  await assert.rejects(
    () => mock.submit({}, {}),
    error =>
      error instanceof ProviderError &&
      error.code === ERROR_CODES.NOT_CONFIGURED &&
      error.httpStatus === 503
  );
});

test("mock provider becomes available only with explicit configuration", async () => {
  const env = { ENABLE_MOCK_PROVIDER: "true" };

  assert.equal(mock.isConfigured(env), true);

  const health = await mock.health(env);
  assert.equal(health.status, "available");
});

test("mock submission is simulated and creates no real clips", async () => {
  const env = { ENABLE_MOCK_PROVIDER: "true" };

  const result = await mock.submit({}, env);

  assert.equal(result.ok, true);
  assert.equal(result.httpStatus, 202);
  assert.match(result.providerJobId, /^mock_/);
  assert.equal(result.raw.mock, true);
  assert.match(result.raw.message, /No video was processed/);
});

test("mock results never pretend to contain real clips", async () => {
  const result = await mock.results(
    "mock_test123",
    { ENABLE_MOCK_PROVIDER: "true" }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, "processing");
  assert.deepEqual(result.clips, []);
  assert.equal(result.raw.mock, true);
});

test("mock provider rejects invalid job IDs", async () => {
  await assert.rejects(
    () => mock.results(
      "not-a-mock-id",
      { ENABLE_MOCK_PROVIDER: "true" }
    ),
    error =>
      error instanceof ProviderError &&
      error.code === ERROR_CODES.UNSUPPORTED_JOB
  );
});
