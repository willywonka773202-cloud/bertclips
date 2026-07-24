import { jsonOk } from "@/lib/core/api";
import { getClippingSnapshot } from "@/lib/clipping/snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clipping — the READ-ONLY cockpit snapshot: earnings (cash-truth ledger),
 * campaigns, the source queue, clips awaiting review, engine dependency health, and
 * the latest free-research recommendation. No generation/posting happens here — those
 * are the /generate and /action routes (explicit, gated). Fail-soft.
 */
export async function GET(): Promise<Response> {
  return jsonOk(await getClippingSnapshot());
}
