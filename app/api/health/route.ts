import { jsonOk } from "@/lib/core/api";
import { ensureClippingHeartbeat } from "@/lib/clipping/heartbeat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health — liveness probe that ALSO idempotently starts the 24/7 heartbeat.
 * Hit it once after the service boots (a systemd/pm2 post-start curl, an uptime monitor,
 * or the first cockpit load) and the autonomous loops keep ticking browser-independently.
 */
export async function GET(): Promise<Response> {
  const hb = ensureClippingHeartbeat();
  return jsonOk({ ok: true, heartbeat: hb, at: new Date().toISOString() });
}
