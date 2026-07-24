import { NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/core/api";
import { getClippingSnapshot } from "@/lib/clipping/snapshot";
import { runClippingProducerNow } from "@/lib/clipping/producer";
import { runClippingResearchNow } from "@/lib/clipping/research";
import {
  addCampaign,
  addChannel,
  addEarning,
  addGamePromo,
  addSource,
  recordClipPost,
  removeCampaign,
  removeChannel,
  removeGamePromo,
  removeSource,
  setClipStatus,
  setClippingConfig,
  updateCampaign,
  updateGamePromo,
} from "@/lib/clipping/store";
import { promoteGame } from "@/lib/roblox/creator/promo";
import type { ClipPlatform, ClippingCampaign, GamePromo, GamePromoPhase, ClippingConfig } from "@/types/clipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/clipping/action — every cockpit MUTATION except starting the render engine
 * (that is /generate). One dispatcher keeps the surface small. Posting a clip is a
 * user-recorded action here (mark-posted) — the app itself never auto-posts to a social
 * platform. Returns the fresh snapshot so the cockpit updates in one round-trip.
 */

const PLATFORMS: ClipPlatform[] = ["tiktok", "instagram", "youtube", "x"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function n(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function platform(v: unknown): ClipPlatform | undefined {
  return typeof v === "string" && (PLATFORMS as string[]).includes(v) ? (v as ClipPlatform) : undefined;
}
function phase(v: unknown): GamePromoPhase | undefined {
  return v === "progress" || v === "launch" ? v : undefined;
}
function platformList(v: unknown): ClipPlatform[] {
  return Array.isArray(v) ? v.map(platform).filter((p): p is ClipPlatform => Boolean(p)) : [];
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonError("BAD_JSON", "Request body must be JSON.");
  }
  const action = str(body.action);
  if (!action) return jsonError("ACTION_REQUIRED", "An 'action' is required.");

  try {
    switch (action) {
      case "set-config": {
        const patch = (body.config ?? {}) as Partial<ClippingConfig>;
        await setClippingConfig(patch);
        break;
      }
      case "add-campaign": {
        const name = str(body.name);
        const pay = n(body.payPerThousandUsd);
        if (!name || pay === undefined) return jsonError("INVALID", "Campaign needs a name and a CPM (payPerThousandUsd).");
        const targets = Array.isArray(body.targetPlatforms)
          ? body.targetPlatforms.map(platform).filter((p): p is ClipPlatform => Boolean(p))
          : [];
        await addCampaign({
          name,
          creator: str(body.creator),
          platform: str(body.platform) ?? "Whop",
          sourceHint: str(body.sourceHint),
          payPerThousandUsd: pay,
          budgetRemainingUsd: n(body.budgetRemainingUsd) ?? null,
          minPayoutViews: n(body.minPayoutViews) ?? null,
          targetPlatforms: targets.length ? targets : ["tiktok", "instagram", "youtube"],
          requirements: str(body.requirements),
          link: str(body.link),
          note: str(body.note),
        });
        break;
      }
      case "update-campaign": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Campaign id required.");
        await updateCampaign(id, (body.patch ?? {}) as Partial<ClippingCampaign>);
        break;
      }
      case "remove-campaign": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Campaign id required.");
        await removeCampaign(id);
        break;
      }
      case "add-promo": {
        const game = str(body.game);
        if (!game) return jsonError("INVALID", "A game name is required (e.g. Punch Simulator).");
        const targets = platformList(body.targetPlatforms);
        const promo = await addGamePromo({
          game,
          robloxAccount: str(body.robloxAccount),
          gameUrl: str(body.gameUrl),
          universeId: str(body.universeId),
          phase: phase(body.phase) ?? "progress",
          postProfile: str(body.postProfile),
          // Empty -> the store fills the connected default (builtbybert on TikTok/Instagram/X).
          targetPlatforms: targets,
          cta: str(body.cta),
          note: str(body.note),
        });
        // Best-effort: create the game's drop folder on the local factory so gameplay
        // recordings become promo clips. Offline-graceful (no-op off the local host).
        await promoteGame(promo.game).catch(() => undefined);
        break;
      }
      case "update-promo": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Promo id required.");
        await updateGamePromo(id, (body.patch ?? {}) as Partial<GamePromo>);
        break;
      }
      case "remove-promo": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Promo id required.");
        await removeGamePromo(id);
        break;
      }
      case "add-source": {
        const url = str(body.url);
        if (!url) return jsonError("INVALID", "Source url required.");
        await addSource({ url, campaignId: str(body.campaignId) ?? null, gamePromoId: str(body.gamePromoId) ?? null, clipsRequested: n(body.clipsRequested) });
        break;
      }
      case "remove-source": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Source id required.");
        await removeSource(id);
        break;
      }
      case "approve-clip": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Clip id required.");
        await setClipStatus(id, "approved");
        break;
      }
      case "reject-clip": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Clip id required.");
        await setClipStatus(id, "rejected");
        break;
      }
      case "mark-posted": {
        const id = str(body.id);
        const plat = platform(body.platform);
        if (!id || !plat) return jsonError("INVALID", "Clip id and a valid platform are required.");
        await recordClipPost(id, { platform: plat, url: str(body.url), views: n(body.views), earnedUsd: n(body.earnedUsd) });
        break;
      }
      case "add-earning": {
        const amount = n(body.amountUsd);
        if (amount === undefined) return jsonError("INVALID", "amountUsd required.");
        await addEarning({
          amountUsd: amount,
          source: (str(body.source) as "campaign" | "organic" | "manual") ?? "manual",
          clipId: str(body.clipId) ?? null,
          campaignId: str(body.campaignId) ?? null,
          channelId: str(body.channelId) ?? null,
          platform: platform(body.platform) ?? null,
          views: n(body.views) ?? null,
          note: str(body.note),
        });
        break;
      }
      case "add-channel": {
        const handle = str(body.handle);
        const plat = platform(body.platform);
        if (!handle || !plat) return jsonError("INVALID", "Channel handle and platform required.");
        await addChannel({ handle, platform: plat, niche: str(body.niche), note: str(body.note) });
        break;
      }
      case "remove-channel": {
        const id = str(body.id);
        if (!id) return jsonError("INVALID", "Channel id required.");
        await removeChannel(id);
        break;
      }
      case "research-now": {
        const started = await runClippingResearchNow();
        return jsonOk({ started: started.started, snapshot: await getClippingSnapshot() });
      }
      case "produce-now": {
        const started = await runClippingProducerNow();
        return jsonOk({ started: started.started, snapshot: await getClippingSnapshot() });
      }
      default:
        return jsonError("UNKNOWN_ACTION", `Unknown action: ${action}`);
    }
  } catch (err) {
    return jsonError("ACTION_FAILED", err instanceof Error ? err.message : String(err), 500);
  }

  return jsonOk({ ok: true, snapshot: await getClippingSnapshot() });
}
