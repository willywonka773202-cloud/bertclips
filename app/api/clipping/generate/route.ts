import { NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/core/api";
import { generateClips } from "@/lib/clipping/engine";
import { addSource, getClippingConfig, readClippingStore } from "@/lib/clipping/store";
import { getClippingSnapshot } from "@/lib/clipping/snapshot";
import type { ClipAspect, ClipPlatform } from "@/types/clipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clipping/generate — the GATED render action (an explicit user click).
 *
 * Kicks off the free local engine (yt-dlp -> whisper -> rank -> ffmpeg) in the
 * background and returns immediately; progress is written onto the source row and the
 * finished clips land in the review queue as status "review". The kill switch + the
 * daily caps (enforced in the engine) bound it; NOTHING is ever posted here.
 */

const ASPECTS: ClipAspect[] = ["9:16", "1:1", "16:9"];
const PLATFORMS: ClipPlatform[] = ["tiktok", "instagram", "youtube", "x"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("BAD_JSON", "Request body must be JSON.");
  }

  const config = await getClippingConfig();
  if (config.killSwitch) return jsonError("KILL_SWITCH", "Kill switch is on — disarm it to generate clips.", 409);

  const store = await readClippingStore();
  let sourceId = str(body.sourceId);
  let url = str(body.url);
  let campaignId = str(body.campaignId) ?? null;

  if (sourceId) {
    const src = store.sources.find((s) => s.id === sourceId);
    if (!src) return jsonError("NOT_FOUND", "Source not found.", 404);
    url = src.url;
    campaignId = src.campaignId ?? campaignId;
  }
  if (!url) return jsonError("INVALID", "A url or sourceId is required.");

  if (!sourceId) {
    const created = await addSource({ url, campaignId, clipsRequested: n(body.clipsNum) });
    sourceId = created.id;
  }

  const aspectRaw = str(body.aspect);
  const aspect: ClipAspect | undefined = aspectRaw && (ASPECTS as string[]).includes(aspectRaw) ? (aspectRaw as ClipAspect) : undefined;
  const platforms = Array.isArray(body.platforms)
    ? body.platforms.filter((p): p is ClipPlatform => typeof p === "string" && (PLATFORMS as string[]).includes(p))
    : undefined;

  // Fire-and-forget on the persistent host process; progress lands on the source row.
  void generateClips({
    url,
    sourceId,
    campaignId,
    clipsNum: n(body.clipsNum),
    aspect,
    subtitleFont: str(body.subtitleFont),
    platforms: platforms && platforms.length ? platforms : undefined,
  });

  return jsonOk({ started: true, sourceId, snapshot: await getClippingSnapshot() });
}
