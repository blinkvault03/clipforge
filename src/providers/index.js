
import { createRegistry } from "../core/registry.js";
import { opusclip } from "./opusclip.js";
import { mock } from "./mock.js";

/**
 * ClipForge provider registry.
 *
 * OpusClip is optional and never selected implicitly.
 * Mock mode requires explicit ENABLE_MOCK_PROVIDER=true.
 * No provider is silently substituted.
 */
export function createDefaultRegistry(env = {}) {
  const providers = [];

  // Register mock only when explicitly enabled.
  if (env.ENABLE_MOCK_PROVIDER === "true") {
    providers.push(mock);
  }

  // Register OpusClip only when explicitly enabled.
  if (env.ENABLE_OPUSCLIP_PROVIDER === "true") {
    providers.push(opusclip);
  }

  const requestedDefault = env.DEFAULT_PROVIDER || null;

  // Never silently select a provider.
  if (requestedDefault && !providers.some(p => p.id === requestedDefault)) {
    throw new Error(
      `Configured default provider "${requestedDefault}" is not enabled.`
    );
  }

  return createRegistry(providers, {
    defaultId: requestedDefault
  });
}
