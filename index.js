import { createRegistry } from "../core/registry.js";
import { opusclip } from "./opusclip.js";

/** Phase 1: OpusClip is the only registered provider and the default (V6.2 compatibility). Phase 2 adds config-based selection. */
export function createDefaultRegistry() {
  return createRegistry([opusclip], { defaultId: "opusclip" });
}
