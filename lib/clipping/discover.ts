import "server-only";

import { appendLog } from "@/lib/core/logging";
import { pythonBin } from "./paths";
import { run } from "./proc";
import { addSource, readClippingStore } from "./store";
import type { ClippingStore } from "@/types/clipping";

/**
 * lib/clipping/discover.ts — FREE source auto-discovery that closes the loop.
 *
 * The producer only clips what is queued. This finds new source VODs automatically so a
 * truly hands-off run never starves: for each active campaign whose `sourceHint` is a
 * channel / playlist URL (the creator's own content the campaign wants clipped), it lists
 * the latest uploads with yt-dlp (flat, metadata-only — no download, no cost) and queues
 * the ones we have not seen. It NEVER invents arbitrary URLs — it only follows a channel
 * the user explicitly attached to a campaign, so what gets clipped stays on-mandate.
 *
 * Bounded on every axis: runs only when the pending queue is low, takes at most a few new
 * videos per campaign per pass, and dedupes against every source already on record.
 */

const MAX_NEW_PER_CAMPAIGN = 3;
// Only top up when the queue is nearly dry, so discovery can't balloon the backlog.
const QUEUE_LOW_WATERMARK = 2;

function isUrl(v: string | undefined | null): v is string {
  if (!v) return false;
  return /^https?:\/\//i.test(v.trim());
}

function sourceKindFor(url: string): "youtube" | "twitch" {
  return /twitch\.tv/i.test(url) ? "twitch" : "youtube";
}

/** List the latest video URLs (+titles) from a channel/playlist. Metadata only. */
async function listChannelVideos(channelUrl: string, limit: number): Promise<Array<{ url: string; title?: string }>> {
  const r = await run(
    pythonBin(),
    [
      "-m",
      "yt_dlp",
      "--js-runtimes",
      "node",
      "--flat-playlist",
      "--no-warnings",
      "--playlist-end",
      String(limit),
      "--print",
      "%(url)s\t%(title)s",
      channelUrl,
    ],
    { timeoutMs: 90_000 },
  );
  if (r.code !== 0) {
    await appendLog({ level: "warn", source: "clipping:discover", message: `list failed for ${channelUrl}: ${r.stderr.slice(-300)}` });
    return [];
  }
  const out: Array<{ url: string; title?: string }> = [];
  for (const line of r.stdout.split(/\r?\n/)) {
    const [url, title] = line.split("\t");
    if (isUrl(url)) out.push({ url: url.trim(), title: title?.trim() || undefined });
  }
  return out;
}

/**
 * One discovery pass. Returns how many new sources were queued. Never throws. Gated by
 * the caller to armed + autoGenerate; here we only enforce the queue watermark + dedupe.
 */
export async function runClippingDiscovery(store?: ClippingStore): Promise<{ queued: number }> {
  try {
    const s = store ?? (await readClippingStore());
    if (s.config.killSwitch) return { queued: 0 };

    const pending = s.sources.filter((x) => x.status === "pending").length;
    if (pending >= QUEUE_LOW_WATERMARK) return { queued: 0 };

    // Everything we already know about, so we never re-queue the same VOD.
    const known = new Set(s.sources.map((x) => x.url.trim()));
    const campaigns = s.campaigns.filter((c) => c.active && isUrl(c.sourceHint));
    if (!campaigns.length) return { queued: 0 };

    let queued = 0;
    for (const campaign of campaigns) {
      const videos = await listChannelVideos(campaign.sourceHint as string, MAX_NEW_PER_CAMPAIGN + 4);
      let addedForThis = 0;
      for (const v of videos) {
        if (addedForThis >= MAX_NEW_PER_CAMPAIGN) break;
        if (known.has(v.url)) continue;
        known.add(v.url);
        await addSource({ url: v.url, kind: sourceKindFor(v.url), title: v.title, campaignId: campaign.id });
        addedForThis += 1;
        queued += 1;
      }
    }
    if (queued > 0) {
      await appendLog({ level: "info", source: "clipping:discover", message: `auto-queued ${queued} new source VOD(s) from ${campaigns.length} campaign channel(s)` });
    }
    return { queued };
  } catch (e) {
    await appendLog({ level: "warn", source: "clipping:discover", message: e instanceof Error ? e.message : String(e) }).catch(() => {});
    return { queued: 0 };
  }
}
