import { assertProvider, ProviderError, ERROR_CODES } from "./contract.js";

/** Holds the available providers. Selection by configuration is layered on top of this in Phase 2. */
export function createRegistry(providers = [], { defaultId } = {}) {
  const map = new Map();
  const api = {
    register(p) {
      assertProvider(p);
      if (map.has(p.id)) throw new Error(`Provider "${p.id}" is already registered`);
      map.set(p.id, p);
      return api;
    },
    has: id => map.has(id),
    get: id => map.get(id) || null,
    list: () => [...map.values()],
    defaultId: () => defaultId && map.has(defaultId) ? defaultId : (map.keys().next().value ?? null),
    resolve(id) {
      const use = id || api.defaultId();
      const p = use && map.get(use);
      if (!p) throw new ProviderError(ERROR_CODES.UNKNOWN_PROVIDER, `Unknown provider "${use ?? ""}".`);
      return p;
    }
  };
  providers.forEach(p => api.register(p));
  return api;
}
