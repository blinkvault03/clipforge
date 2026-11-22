import { COST_CLASSES } from "../src/core/contract.js";
/** A minimal valid provider for contract/registry tests (test double, not shipped as a real provider). */
export function makeFakeProvider(over = {}) {
  return {
    id: "fake", label: "Fake", cost: "free", dataFlow: "local", requiresCredentials: false,
    capabilities: {
      sourceTypes: ["url", "file"], aspectRatios: ["portrait", "landscape", "square"], clipDuration: { min: 10, max: 90 }, maxDurationRanges: 2,
      features: { customPrompt: false, genre: false, language: false, autoCuration: true },
      campaign: { durationRange: true, aspectRatio: true, captions: true, hooks: false, hashtags: false, overlays: false, prohibitedContent: false },
      export: { providerLinks: false, hdExport: true }
    },
    isConfigured: () => true,
    health: async () => ({ status: "available" }),
    submit: async () => ({ ok: true, httpStatus: 200, providerJobId: "f1", raw: {} }),
    results: async () => ({ ok: true, httpStatus: 200, raw: {}, status: "processing", clips: [] }),
    ...over
  };
}
export const COSTS = COST_CLASSES;
export const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status });
