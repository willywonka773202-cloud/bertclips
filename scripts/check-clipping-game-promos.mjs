import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Guard for Game promos in the Clipping command center — the operator's OWN Roblox
 * games promoted through clips (dev-progress hype now, launch ads at release). A promo
 * is the INVERSE of a paid campaign, so its invariants must never regress:
 *
 *  1. Free-first by construction. A promo carries NO CPM / pay field, so it can never
 *     be mistaken for or routed to a paid lane (hard rule 1).
 *  2. Phase opens at "progress". A new/normalized promo is dev-progress, never "launch"
 *     unless explicitly graduated — releasing ads is a deliberate step.
 *  3. Connect-accounts-later. The promo registers now; the Roblox + posting accounts
 *     wire in later. The factory drop-folder bridge is best-effort + offline-graceful.
 *  4. The promo flows into the read-only snapshot the cockpit renders.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "..", p), "utf8");

// ── 1. The type is free-first: a promo has no CPM / pay field ────────────────
const types = read("types/clipping.ts");
const promoBlock = types.slice(types.indexOf("export interface GamePromo"), types.indexOf("export interface ClipSource"));
assert.match(promoBlock, /export interface GamePromo/, "GamePromo type exists");
assert.match(types, /export type GamePromoPhase = "progress" \| "launch"/, "phase union is progress|launch");
assert.doesNotMatch(promoBlock, /payPerThousand|CPM|cpm|budgetRemaining|payPer/, "a promo carries NO paid-lane / CPM field (free-first)");
assert.match(types, /gamePromos: GamePromo\[\]/, "the store + snapshot expose gamePromos");

// ── 2 + 3. Store normalizes safely: phase defaults to progress, active true ──
const store = read("lib/clipping/store.ts");
assert.match(store, /v === "launch" \? "launch" : "progress"/, "phase defaults to progress, only 'launch' opts into launch");
assert.match(store, /active: p\.active !== false/, "a promo is active unless explicitly disabled");
assert.match(store, /gamePromos: Array\.isArray\(s\.gamePromos\) \? s\.gamePromos\.map\(normalizePromo\) : \[\]/, "gamePromos normalize to a safe default array");
assert.match(store, /export function slugifyGame/, "slug helper bridges the factory drop folder");
// The connected posting profile default must match the factory's promo profile, and the
// default platforms are the connected set (upload-post: TikTok / Instagram / X).
assert.match(store, /DEFAULT_PROMO_PROFILE = "builtbybert"/, "promos post via the connected builtbybert profile by default");
assert.match(store, /DEFAULT_PROMO_PLATFORMS: ClipPlatform\[\] = \["tiktok", "instagram", "x"\]/, "default promo platforms are the connected set");
const promoRail = read("lib/roblox/creator/promo.ts");
assert.match(promoRail, /PROMO_PROFILE = "builtbybert"/, "the store default matches the factory promo profile (single source of truth)");
// The promo store path never touches the earnings ledger / CPM.
const promoFns = store.slice(store.indexOf("Game promos"), store.indexOf("// ── Sources"));
assert.doesNotMatch(promoFns, /earnings|payPerThousand|amountUsd/, "promo CRUD never writes earnings or a CPM");

// ── 3. The action route wires add/update/remove + a best-effort local bridge ─
const route = read("app/api/clipping/action/route.ts");
for (const a of ["add-promo", "update-promo", "remove-promo"]) {
  assert.match(route, new RegExp(`case "${a}"`), `action route handles ${a}`);
}
assert.match(route, /promoteGame\(promo\.game\)\.catch\(\(\) => undefined\)/, "the factory drop-folder bridge is best-effort (offline-graceful)");
assert.match(route, /phase\(body\.phase\) \?\? "progress"/, "a new promo opens at the progress phase");

// ── 4. The promo reaches the read-only cockpit snapshot ─────────────────────
const snapshot = read("lib/clipping/snapshot.ts");
assert.match(snapshot, /gamePromos: store\.gamePromos/, "the snapshot surfaces gamePromos to the cockpit");

console.log("check-clipping-game-promos: OK");
