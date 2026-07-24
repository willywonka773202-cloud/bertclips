import "server-only";

import { readClippingStore, summarizeEarnings } from "./store";
import type { ClippingConfig, ClippingEarningsSummary } from "@/types/clipping";

/**
 * lib/clipping/earnings.ts — the READ-ONLY cash-truth reader the Money Hub consumes.
 *
 * The earnings LEDGER is the single source of money truth (only measured, recorded
 * payouts count — never a clip's own optimistic view estimate). This exposes the
 * roll-up + the config the hub needs, without pulling any write path into that view.
 */
export async function readClippingEarnings(): Promise<{ summary: ClippingEarningsSummary; config: ClippingConfig }> {
  const store = await readClippingStore();
  return { summary: summarizeEarnings(store), config: store.config };
}
