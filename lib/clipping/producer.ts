import "server-only";

import { appendLog } from "@/lib/core/logging";
import { runClippingDiscovery } from "./discover";
import { generateClips } from "./engine";
import { connectedPostingPlatforms, isPostingWired, postClip, type PostResult } from "./poster";
import { noteProduce, readClippingStore, recordClipPost, setClipStatus, updateClip } from "./store";
import type { Clip, ClippingStore } from "@/types/clipping";

/**
 * lib/clipping/producer.ts — the autonomous, FREE, off-by-default clip PRODUCER.
 *
 * When armed (config.armed && config.autoGenerate && !killSwitch) this ticks on the 24/7
 * heartbeat and, at its own cadence, takes the oldest queued source and runs the free
 * local engine (yt-dlp + whisper + ffmpeg) to generate + stage clips into the review
 * queue. It NEVER touches the paid render lane (free-first) and it never invents source
 * URLs — it only clips what is already queued, so an empty queue is a quiet no-op.
 *
 * Auto-post is a SEPARATE, outward action gated behind config.autoPost AND a connected
 * posting rail (lib/clipping/poster.ts). With no rail wired it stays fully dormant, so
 * "arm auto-post" is a pre-authorization that activates the tick a real rail lands — the
 * same paper->live shape the trading venues use. Every pass is best-effort and never
 * throws; the daily caps + kill switch (enforced inside the engine) bound the work.
 */

let passInFlight = false;

export function isClippingProducerRunning(): boolean {
  return passInFlight;
}

function producerDue(store: ClippingStore, nowMs: number): boolean {
  const c = store.config;
  if (!c.armed || !c.autoGenerate || c.killSwitch) return false;
  if (!store.lastProduceAt) return true;
  const last = Date.parse(store.lastProduceAt);
  if (!Number.isFinite(last)) return true;
  // Reuse the research cadence, floored at 60 min — generation is heavy work.
  const gapMs = Math.max(60, c.intervalMinutes) * 60_000;
  return nowMs - last >= gapMs;
}

/** Auto-approve freshly-staged clips at/above the score threshold (0 disables). Returns
 *  how many were approved. Only clips that actually rendered ("review") are eligible. */
async function autoApprove(clips: Clip[], minScore: number): Promise<number> {
  if (!minScore || minScore <= 0) return 0;
  let n = 0;
  for (const clip of clips) {
    if (clip.status === "review" && clip.viralityScore >= minScore) {
      await setClipStatus(clip.id, "approved").catch(() => {});
      n += 1;
    }
  }
  return n;
}

/** The oldest source still waiting to be clipped, or null when the queue is empty. */
function nextPendingSource(store: ClippingStore) {
  const pending = store.sources.filter((s) => s.status === "pending");
  if (!pending.length) return null;
  return pending.reduce((oldest, s) => (Date.parse(s.addedAt) < Date.parse(oldest.addedAt) ? s : oldest));
}

/**
 * Run ONE producer pass: stamp the cadence clock up front (so a multi-minute render
 * can't re-enter), then generate + stage clips from the next queued source. Never throws.
 */
export async function runClippingProducer(): Promise<{ ok: boolean; reason?: string }> {
  if (passInFlight) return { ok: false, reason: "A producer pass is already running." };
  passInFlight = true;
  try {
    let store = await readClippingStore();
    const c = store.config;
    if (c.killSwitch) return { ok: false, reason: "Kill switch is on." };
    if (!c.armed || !c.autoGenerate) return { ok: false, reason: "Producer is not armed." };

    if (store.counters.renders >= c.caps.maxRendersPerDay) {
      await noteProduce({ note: `Daily render cap reached (${c.caps.maxRendersPerDay}) — waiting for the day to roll over.` });
      return { ok: false, reason: "Daily render cap reached." };
    }

    let source = nextPendingSource(store);
    if (!source) {
      // Empty queue: try to auto-discover fresh VODs from campaign source channels.
      const { queued } = await runClippingDiscovery(store);
      if (queued > 0) {
        store = await readClippingStore();
        source = nextPendingSource(store);
      }
    }
    if (!source) {
      await noteProduce({
        note: "No queued sources to clip — add a source VOD, or set a campaign's source channel URL and clips will queue automatically.",
      });
      return { ok: false, reason: "No queued sources." };
    }

    // Stamp the clock BEFORE the long render so the next tick doesn't double-fire.
    await noteProduce({ note: `Generating clips from "${source.title || source.url}"...` });
    const result = await generateClips({ url: source.url, sourceId: source.id, campaignId: source.campaignId ?? null });

    const made = result.clips.filter((x) => x.status === "review").length;
    const approved = await autoApprove(result.clips, c.autoApproveMinScore);
    const tail = approved > 0 ? ` ${approved} auto-approved (score >= ${c.autoApproveMinScore})` : " waiting in review";
    const note = result.ok
      ? `Staged ${made} clip${made === 1 ? "" : "s"} from "${source.title || source.url}" —${tail}.`
      : `Could not clip "${source.title || source.url}": ${result.reason ?? "unknown error"}.`;
    // touchClock:false — the clock was already stamped when the pass began.
    await noteProduce({ note, touchClock: false });
    return { ok: result.ok, reason: result.reason };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    await noteProduce({ note: `Producer error: ${reason}`, touchClock: false }).catch(() => {});
    return { ok: false, reason };
  } finally {
    passInFlight = false;
  }
}

/**
 * Auto-post pass: publish approved clips when config.autoPost is armed AND a real posting
 * rail is connected. Fully dormant (does nothing) while no rail is wired — no store churn,
 * no outward calls. Best-effort; never throws.
 */
async function runAutoPostPass(store: ClippingStore): Promise<void> {
  if (!store.config.autoPost || store.config.killSwitch) return;
  if (!isPostingWired()) return; // dormant pre-authorization until a rail lands
  const approved = store.clips.filter((c) => c.status === "approved");
  if (!approved.length) return;

  const platforms = connectedPostingPlatforms();
  for (const clip of approved) {
    const res = await postClip(clip).catch((e): PostResult => ({ posted: false, reason: e instanceof Error ? e.message : String(e) }));
    if (res.posted && res.platform) {
      await recordClipPost(clip.id, { platform: res.platform, url: res.url });
      await appendLog({ level: "info", source: "clipping:producer", message: `auto-posted clip ${clip.id} to ${res.platform}` });
    } else {
      await updateClip(clip.id, { error: res.reason }).catch(() => {});
    }
  }
  void platforms;
}

/** Cheap idempotent heartbeat tick: run the auto-post pass, then a generation pass if due. */
export async function tickClippingProducer(): Promise<void> {
  const store = await readClippingStore().catch(() => null);
  if (!store) return;
  await runAutoPostPass(store).catch(() => {});
  if (passInFlight) return;
  if (!producerDue(store, Date.now())) return;
  void runClippingProducer();
}

/** Fire a producer pass now (background) — the cockpit "generate next" one-tap. */
export async function runClippingProducerNow(): Promise<{ started: boolean }> {
  if (passInFlight) return { started: false };
  void runClippingProducer();
  return { started: true };
}
