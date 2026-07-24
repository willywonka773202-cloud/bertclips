import "server-only";

interface HeaderCarrier {
  headers: { get(name: string): string | null };
}

/**
 * Standalone bertclips gate. On a private VPS the service usually runs behind your own
 * firewall / reverse proxy, so mutations are allowed by default. Set BERTCLIPS_GATE_TOKEN
 * to require an `x-bertclips-token` header on POST routes (returns true = BLOCK when the
 * token is set and the header does not match).
 */
export function publicEdgeGateInactive(req: HeaderCarrier): boolean {
  const token = (process.env.BERTCLIPS_GATE_TOKEN || "").trim();
  if (!token) return false; // no gate configured -> never block
  return req.headers.get("x-bertclips-token") !== token;
}
