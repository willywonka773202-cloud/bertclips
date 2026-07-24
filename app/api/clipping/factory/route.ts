import type { NextRequest } from "next/server";

import { jsonError, jsonOk } from "@/lib/core/api";
import {
  markFactorySubmitted,
  readFactoryStatus,
  runFactoryTask,
  setFactoryArmed,
} from "@/lib/clipping/factory-bridge";
import { publicEdgeGateInactive } from "@/lib/security/powerful-route-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/clipping/factory — the bridge to the LIVE local posting factory (BertClipsHub).
 *
 * GET  → the read-only operational status (accounts, buffers, schedule, payout queue,
 *        alerts, activity). Offline-graceful: on the public edge it returns online=false.
 * POST → control the factory's OWN already-safe tasks (fill / generate / post / collect),
 *        arm/disarm its autopost loop, or mark clips submitted. Because these can trigger
 *        REAL public posts, the POST is refused over the public edge when the access gate
 *        is (accidentally) inactive — exactly like the other powerful local-control routes.
 */
export async function GET(): Promise<Response> {
  return jsonOk(await readFactoryStatus());
}

export async function POST(req: NextRequest): Promise<Response> {
  if (publicEdgeGateInactive(req)) {
    return jsonError(
      "access_gate_required",
      "Controlling the live posting factory is disabled over the public edge until BERTOS_ACCESS_PASSWORD is set.",
      403,
    );
  }

  let body: { action?: string; task?: string; armed?: boolean; clips?: unknown; submitted?: boolean };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return jsonError("bad_request", "Expected a JSON body.", 400);
  }

  const action = String(body.action || "");

  if (action === "run") {
    const r = await runFactoryTask(String(body.task || ""));
    if (!r.ok) return jsonError("factory_run_failed", r.reason || "The task could not be started.", 409);
    return jsonOk(await readFactoryStatus());
  }

  if (action === "arm" || action === "disarm") {
    const r = await setFactoryArmed(action === "arm");
    if (!r.ok) return jsonError("factory_arm_failed", r.reason || "Could not change the armed state.", 409);
    return jsonOk(await readFactoryStatus());
  }

  if (action === "mark-submitted") {
    const clips = Array.isArray(body.clips) ? body.clips.map((c) => String(c)).filter(Boolean) : [];
    if (!clips.length) return jsonError("bad_request", "Provide at least one clip id.", 400);
    const r = await markFactorySubmitted(clips, body.submitted !== false);
    if (!r.ok) return jsonError("factory_mark_failed", r.reason || "Could not update the payout queue.", 409);
    return jsonOk(await readFactoryStatus());
  }

  return jsonError("bad_request", `Unknown action: ${action || "(none)"}.`, 400);
}
