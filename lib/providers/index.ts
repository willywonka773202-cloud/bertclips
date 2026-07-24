import "server-only";
import type { ProviderId } from "@/types/provider";

/**
 * Standalone bertclips: there is no bundled AI provider stack. Reporting "none online"
 * makes the clip ranker (lib/clipping/rank.ts) fall back to its deterministic heuristic,
 * so rendering never blocks on a brain. Wire real providers here later if you want
 * AI-scored highlights on the VPS.
 */
export async function onlineProviderIds(): Promise<ProviderId[]> {
  return [];
}
