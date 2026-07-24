import "server-only";

import { noteResearch } from "./store";

/**
 * lib/clipping/research.ts — STANDALONE STUB.
 *
 * In bert-ai the research loop is a free GLM "council" that discovers + ranks sources
 * and campaigns (it never renders or posts). It tangles into the whole provider /
 * memory / council stack, which the standalone bertclips service does not bundle. This
 * stub keeps the exact export surface so the snapshot, the action route, and any
 * heartbeat wiring compile and run — research is simply inert here.
 *
 * To bring research to the VPS later, port lib/providers + lib/chat/council + lib/memory
 * from bert-ai and restore the real implementation.
 */

const DISABLED_NOTE =
  "Research is disabled in the standalone build (no bundled AI council). The engine, ledger, campaigns, and game promos are fully active.";

export async function runClippingResearch(): Promise<{ ok: boolean; recommendation?: string; reason?: string }> {
  await noteResearch({ recommendation: DISABLED_NOTE });
  return { ok: false, reason: DISABLED_NOTE };
}

export function isClippingResearchRunning(): boolean {
  return false;
}

export async function runClippingResearchNow(): Promise<{ started: boolean }> {
  await noteResearch({ recommendation: DISABLED_NOTE });
  return { started: false };
}

export async function tickClippingResearch(): Promise<void> {
  // inert in the standalone build
}
