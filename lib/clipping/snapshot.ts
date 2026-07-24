import "server-only";

import { checkClipDeps } from "./deps";
import { readFactoryStatus } from "./factory-bridge";
import { isPostingWired } from "./poster";
import { isClippingProducerRunning } from "./producer";
import { isClippingResearchRunning } from "./research";
import { readClippingStore, summarizeEarnings } from "./store";
import type { ClippingSnapshot, DepsReport } from "@/types/clipping";

/**
 * lib/clipping/snapshot.ts — assemble the full READ-ONLY cockpit view. Fail-soft: if
 * the dep probe throws, the snapshot still returns with engineReady=false so the
 * cockpit renders a setup card rather than a broken page. The live factory read is
 * itself offline-graceful, so it never breaks the snapshot either.
 */
export async function getClippingSnapshot(): Promise<ClippingSnapshot> {
  const fallbackDeps: DepsReport = { ok: false, engineReady: false, deps: [], checkedAt: new Date().toISOString() };
  const [store, deps, factory] = await Promise.all([
    readClippingStore(),
    checkClipDeps().catch(() => fallbackDeps),
    readFactoryStatus().catch(() => undefined),
  ]);

  const actionClips = store.clips.filter((c) => c.status === "review" || c.status === "approved" || c.status === "rendering");
  const recentClips = store.clips.filter((c) => c.status === "posted" || c.status === "failed" || c.status === "rejected").slice(0, 24);

  return {
    config: store.config,
    summary: summarizeEarnings(store),
    campaigns: store.campaigns,
    gamePromos: store.gamePromos,
    sources: store.sources.slice(0, 30),
    actionClips: actionClips.slice(0, 60),
    recentClips,
    channels: store.channels,
    earnings: store.earnings.slice(0, 30),
    deps,
    researchRunning: isClippingResearchRunning(),
    producerRunning: isClippingProducerRunning(),
    postingWired: isPostingWired(),
    lastResearchAt: store.lastResearchAt,
    lastRecommendation: store.lastRecommendation,
    lastProduceAt: store.lastProduceAt,
    lastProduceNote: store.lastProduceNote,
    lastError: store.lastError,
    factory,
    generatedAt: new Date().toISOString(),
  };
}
