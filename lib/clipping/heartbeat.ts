import "server-only";

import { tickClippingProducer } from "@/lib/clipping/producer";
import { tickClippingFactory } from "@/lib/clipping/factory-tick";
import { tickClippingResearch } from "@/lib/clipping/research";

/**
 * lib/clipping/heartbeat.ts — the browser-independent 24/7 tick for the standalone
 * bertclips service. Started idempotently from GET /api/health, it drives every
 * autonomous loop on an interval so the operation runs unattended on the VPS:
 *
 *  - the autonomous clip PRODUCER (free local engine only; self-gated on armed +
 *    autoGenerate + kill switch — dormant unless the operator armed it),
 *  - the live factory tick (observe + publish; read-only),
 *  - research (inert in the standalone build).
 *
 * Every tick is best-effort and swallows its own errors so one slow loop never wedges
 * the interval. This mirrors bert-ai's heartbeat contract for just the clipping loops.
 */

const INTERVAL_MS = 60_000;

let started = false;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

async function tickOnce(): Promise<void> {
  if (ticking) return; // never overlap a slow pass
  ticking = true;
  try {
    await Promise.allSettled([tickClippingProducer(), tickClippingFactory(), tickClippingResearch()]);
  } finally {
    ticking = false;
  }
}

/** Start the heartbeat once per process. Safe to call on every health hit. */
export function ensureClippingHeartbeat(): { running: boolean; intervalMs: number } {
  if (!started) {
    started = true;
    timer = setInterval(() => void tickOnce(), INTERVAL_MS);
    if (typeof timer.unref === "function") timer.unref();
    void tickOnce(); // kick immediately so the first pass doesn't wait a full interval
  }
  return { running: started, intervalMs: INTERVAL_MS };
}

export function isClippingHeartbeatRunning(): boolean {
  return started;
}
