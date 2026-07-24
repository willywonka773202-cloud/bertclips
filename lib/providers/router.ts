import "server-only";
import type { ProviderId } from "@/types/provider";

type AskResult = { ok: true; data: { text: string } } | { ok: false };

/**
 * Standalone build: no provider to ask. rank.ts only calls this when a free provider is
 * reported online (never, here), so this is a safe unreachable stub kept for import parity.
 */
export async function askProvider(_id: ProviderId, _input: { prompt: string }): Promise<AskResult> {
  return { ok: false };
}
