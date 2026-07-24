import "server-only";

import { publishAiEvent } from "@/lib/aibus/bus";
import { readFactoryStatus } from "./factory-bridge";

/**
 * lib/clipping/factory-tick.ts — surface the LIVE clip factory on the AI activity bus
 * so its operation is visible in the app's event stream without opening the cockpit.
 *
 * READ-ONLY: it observes the factory (itself offline-graceful on the cloud edge) and
 * publishes only notable transitions — a NEW warning appearing, or a triggered run
 * finishing. It never posts, arms, or changes anything. On the first pass it primes
 * its memory silently so a process restart does not replay the whole backlog.
 */

const seenAlerts = new Set<string>();
const runState: Record<string, boolean> = {}; // task -> was running on the previous tick
let primed = false;

export async function tickClippingFactory(): Promise<void> {
  const f = await readFactoryStatus().catch(() => null);
  if (!f || !f.online) return;

  // New warn-level alerts: empty buffers, reauth needed, posting failures, aging
  // unsubmitted clips. Only publish once we have primed (post-restart quiet).
  const warns = f.alerts.filter((a) => a.level === "warn");
  const live = new Set(warns.map((a) => a.msg));
  for (const a of warns) {
    if (seenAlerts.has(a.msg)) continue;
    seenAlerts.add(a.msg);
    if (primed) {
      publishAiEvent({
        source: "clipping:factory",
        kind: "fault",
        title: "Clip factory needs attention",
        detail: a.msg,
      });
    }
  }
  // Forget alerts that have cleared so they re-fire if they recur.
  for (const msg of [...seenAlerts]) if (!live.has(msg)) seenAlerts.delete(msg);

  // Run completions: a task that was running last tick and has now finished.
  for (const [task, run] of Object.entries(f.runs)) {
    const was = runState[task] === true;
    runState[task] = run.running === true;
    if (primed && was && !run.running) {
      const ok = run.code === 0;
      const tail = (run.tail || "").split(/\r?\n/).filter(Boolean).slice(-3).join("\n");
      publishAiEvent({
        source: "clipping:factory",
        kind: "info",
        title: `Clip factory: ${task} ${ok ? "finished" : "failed"}`,
        detail: tail || undefined,
        data: { task, code: run.code },
      });
    }
  }

  primed = true;
}
