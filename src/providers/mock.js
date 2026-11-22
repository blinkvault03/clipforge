
/**
 * ClipForge Mock Provider
 *
 * TESTING ONLY.
 * Does not download, analyse, edit, or render videos.
 * Does not contact OpusClip or any external service.
 *
 * Enable explicitly with:
 * ENABLE_MOCK_PROVIDER=true
 */

import {
  PROVIDER_STATUS,
  ProviderError,
  ERROR_CODES
} from "../core/contract.js";

export const mock = {
  id: "mock",
  label: "ClipForge Mock Provider",
  cost: "free",
  dataFlow: "local",
  requiresCredentials: false,

  configHint:
    "Enable explicitly with ENABLE_MOCK_PROVIDER=true. Testing only.",

  capabilities: {
    sourceTypes: ["url", "file"],
    aspectRatios: ["portrait", "landscape", "square"],
    clipDuration: null,
    maxDurationRanges: 20,

    features: {
      customPrompt: true,
      genre: true,
      language: true,
      autoCuration: true
    },

    campaign: {
      durationRange: true,
      aspectRatio: true,
      captions: true,
      hooks: true,
      hashtags: true,
      overlays: true,
      prohibitedContent: true
    },

    export: {
      providerLinks: false,
      hdExport: false
    }
  },

  isConfigured(env) {
    return env?.ENABLE_MOCK_PROVIDER === "true";
  },

  async health(env) {
    if (!this.isConfigured(env)) {
      return {
        status: PROVIDER_STATUS.UNCONFIGURED,
        detail: this.configHint
      };
    }

    return {
      status: PROVIDER_STATUS.AVAILABLE,
      detail:
        "Mock mode enabled. Requests are simulated; no real video processing or clip generation occurs."
    };
  },

  async submit(job, env) {
    if (!this.isConfigured(env)) {
      throw new ProviderError(
        ERROR_CODES.NOT_CONFIGURED,
        "Mock provider is disabled. Set ENABLE_MOCK_PROVIDER=true to use it.",
        { httpStatus: 503 }
      );
    }

    if (!job || typeof job !== "object") {
      throw new ProviderError(
        ERROR_CODES.UNSUPPORTED_JOB,
        "A valid job is required.",
        { httpStatus: 400 }
      );
    }

    const id =
      globalThis.crypto?.randomUUID?.();

    if (!id) {
      throw new ProviderError(
        ERROR_CODES.NETWORK_ERROR,
        "Secure ID generation is unavailable.",
        { httpStatus: 500 }
      );
    }

    return {
      ok: true,
      httpStatus: 202,
      providerJobId: `mock_${id}`,
      raw: {
        mock: true,
        accepted: true,
        message:
          "This is a simulated submission. No video was processed and no clips were generated."
      }
    };
  },

  async results(providerJobId, env) {
    if (!this.isConfigured(env)) {
      throw new ProviderError(
        ERROR_CODES.NOT_CONFIGURED,
        "Mock provider is disabled.",
        { httpStatus: 503 }
      );
    }

    if (
      typeof providerJobId !== "string" ||
      !providerJobId.startsWith("mock_")
    ) {
      throw new ProviderError(
        ERROR_CODES.UNSUPPORTED_JOB,
        "Invalid mock job ID.",
        { httpStatus: 400 }
      );
    }

    return {
      ok: true,
      httpStatus: 200,
      status: "processing",
      clips: [],
      raw: {
        mock: true,
        message:
          "Mock result only. No real clips or exportable video files exist."
      }
    };
  }
};
