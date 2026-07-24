import "server-only";

import { env } from "@/lib/core/env";
import type {
  FactoryAccount,
  FactoryAlert,
  FactoryConnection,
  FactoryRun,
  FactoryScheduleAccount,
  FactoryStatus,
  FactorySubmissions,
  FactoryTask,
  FactoryTotals,
  FactoryTracking,
} from "@/types/clipping";

/**
 * lib/clipping/factory-bridge.ts — the server-only bridge from BERT AI to the LIVE
 * local clip factory (BertClipsHub) running on loopback :4477.
 *
 * The factory owns the money path: it holds the upload-post credential, runs the
 * yt-dlp / whisper / ffmpeg pipeline, and auto-posts to the real accounts on a
 * per-platform schedule. It stays a local process because it needs those local
 * binaries and the credential. This bridge lets the in-app cockpit READ its
 * operational state (accounts, buffers, schedule, payout queue, alerts, activity)
 * and trigger its OWN already-safe tasks (fill / generate / post / collect).
 *
 * SAFETY (enforced by scripts/check-clipping-factory.mjs):
 *  - Talks to loopback (127.0.0.1 / localhost) only, over http, ENFORCED at runtime:
 *    the base URL is validated against a loopback allow-list and any non-loopback
 *    override is ignored in favour of the safe default, so a tampered env var can
 *    never redirect a request off-box.
 *  - Reachable only in local deployment mode; on the cloud edge it reports offline
 *    WITHOUT a network call (there is no factory there).
 *  - Consumes only the factory's REDACTED surfaces (its /api/state already strips
 *    keys via publicSettings). It never fetches or forwards the upload-post key.
 *  - Fail-soft everywhere: a down or blank factory yields an offline status, never
 *    a throw.
 */

const DEFAULT_HUB_URL = "http://127.0.0.1:4477";
// The env override exists only to point at a different local PORT during dev. Any
// value that is not http-on-loopback is rejected so the bridge cannot be steered
// off-box (SSRF), regardless of what the environment says.
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
function resolveHubUrl(): string {
  const raw = (process.env.BERTCLIPS_HUB_URL || DEFAULT_HUB_URL).trim();
  try {
    const u = new URL(raw);
    if (u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname)) return raw.replace(/\/+$/, "");
  } catch {
    /* malformed URL — fall through to the safe default */
  }
  return DEFAULT_HUB_URL;
}

const HUB_URL = resolveHubUrl();
const REQ_TIMEOUT_MS = 2_500;
const CACHE_TTL_MS = 6_000;

/** Raw per-account shape from the factory's /api/ops (buffers + cadence). */
interface OpsAccount {
  profile: string;
  prefix: string;
  unposted: number;
  bufferTarget: number;
  postsToday: number;
  dailyCap: number;
  lastPostAt: number | null;
  nextEligibleAt: number | null;
  atCap: boolean;
}

/** Raw per-account shape from the factory's /api/accounts (analytics + handles). */
interface AnalyticsAccount {
  profile: string;
  posts: number;
  views: number;
  impressions: number;
  followers: number;
  lastPostAt: string | null;
  platforms: string[];
  handles: Record<string, string>;
  reauth: string[];
  primaryPlatform: string;
  url: string;
}

let statusCache: { at: number; value: Promise<FactoryStatus> } | null = null;

function offline(reason: string): FactoryStatus {
  return {
    online: false,
    reason,
    armed: false,
    accounts: [],
    schedule: [],
    submissions: { programs: [], totalPending: 0, totalSubmitted: 0, agingPending: 0, needsProgram: 0 },
    alerts: [],
    activity: { scheduler: [], autopilot: [] },
    runs: {},
    totals: { accounts: 0, posts: 0, impressions: 0, followers: 0 },
    connections: [],
    tracking: null,
    generatedAt: new Date().toISOString(),
  };
}

/** Raw tracking payload from the factory's /api/tracking (views ledger + lessons). */
interface HubTracking {
  totals?: { posts?: number; tracked?: number; views?: number };
  top?: Array<{ clip?: string; views?: number }>;
  lessons?: {
    durations?: Record<string, { n?: number; med?: number }>;
    hours?: Record<string, { n?: number; med?: number }>;
  } | null;
}

/** Distill the hub's tracking payload into the one-line cockpit shape. */
function distillTracking(t: HubTracking | null): FactoryTracking | null {
  if (!t?.totals) return null;
  const top = (t.top || []).find((x) => (x.views ?? 0) > 0) ?? null;
  const bits: string[] = [];
  const bands = Object.entries(t.lessons?.durations || {})
    .filter(([, v]) => (v.n ?? 0) >= 3)
    .sort((a, b) => (b[1].med ?? 0) - (a[1].med ?? 0));
  const bestBand = bands[0];
  if (bestBand) bits.push(`best length ${bestBand[0]}`);
  const hours = Object.entries(t.lessons?.hours || {})
    .filter(([, v]) => (v.n ?? 0) >= 3)
    .sort((a, b) => (b[1].med ?? 0) - (a[1].med ?? 0));
  const bestHour = hours[0];
  if (bestHour) bits.push(`best hour ${bestHour[0]}:00`);
  return {
    posts: t.totals.posts ?? 0,
    tracked: t.totals.tracked ?? 0,
    views: t.totals.views ?? 0,
    topClip: top?.clip ?? null,
    topViews: top?.views ?? 0,
    lesson: bits.length ? bits.join(" · ") : null,
  };
}

/** GET a factory endpoint with a hard timeout. Returns null on any failure. */
async function hubGet<T>(path: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(`${HUB_URL}${path}`, { signal: controller.signal, cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** POST to a factory endpoint with a hard timeout. Returns null on any failure. */
async function hubPost<T>(path: string, body: unknown): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQ_TIMEOUT_MS);
  try {
    const res = await fetch(`${HUB_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The factory only exists on the local desktop host — never on the public edge. */
export function factoryConfigured(): boolean {
  return env.deploymentMode() === "local";
}

function toIso(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

async function buildStatus(): Promise<FactoryStatus> {
  if (!factoryConfigured()) {
    return offline("The live posting factory runs on the local desktop host, not the public edge.");
  }

  // Fetch the operational surfaces in parallel; each is independently fail-soft.
  const [ops, accountsRes, schedule, submissions, alertsRes, logs, runsRes, connectionsRes, trackingRes] = await Promise.all([
    hubGet<{ accounts: OpsAccount[]; armed: boolean }>("/api/ops"),
    hubGet<{ accounts: AnalyticsAccount[]; totals: FactoryTotals }>("/api/accounts"),
    hubGet<{ accounts: FactoryScheduleAccount[] }>("/api/schedule"),
    hubGet<FactorySubmissions>("/api/submissions"),
    hubGet<{ alerts: FactoryAlert[] }>("/api/alerts"),
    hubGet<{ scheduler: string[]; autopilot: string[] }>("/api/logs"),
    hubGet<{ runs: Record<string, FactoryRun> }>("/api/runs"),
    hubGet<{ connections: FactoryConnection[] }>("/api/connections"),
    hubGet<HubTracking>("/api/tracking"),
  ]);

  // /api/ops is the cheapest, always-local endpoint — if it did not answer, the
  // factory process is not running, so report offline rather than a half status.
  if (!ops) return offline("The local clip factory (BertClipsHub on :4477) is not running.");

  const analyticsByProfile: Record<string, AnalyticsAccount> = {};
  for (const a of accountsRes?.accounts || []) analyticsByProfile[a.profile] = a;

  const accounts: FactoryAccount[] = (ops.accounts || []).map((o) => {
    const a = analyticsByProfile[o.profile];
    return {
      profile: o.profile,
      prefix: o.prefix || "",
      platforms: a?.platforms || [],
      reauth: a?.reauth || [],
      handles: a?.handles || {},
      url: a?.url,
      posts: a?.posts ?? 0,
      impressions: a?.impressions ?? 0,
      followers: a?.followers ?? 0,
      lastPostAt: a?.lastPostAt ?? toIso(o.lastPostAt),
      unposted: o.unposted ?? 0,
      bufferTarget: o.bufferTarget ?? 0,
      postsToday: o.postsToday ?? 0,
      dailyCap: o.dailyCap ?? 0,
      nextEligibleAt: o.nextEligibleAt ?? null,
      atCap: !!o.atCap,
    };
  });

  return {
    online: true,
    armed: ops.armed === true,
    accounts,
    schedule: schedule?.accounts || [],
    submissions:
      submissions || { programs: [], totalPending: 0, totalSubmitted: 0, agingPending: 0, needsProgram: 0 },
    alerts: alertsRes?.alerts || [],
    activity: { scheduler: logs?.scheduler || [], autopilot: logs?.autopilot || [] },
    runs: runsRes?.runs || {},
    totals: accountsRes?.totals || { accounts: accounts.length, posts: 0, impressions: 0, followers: 0 },
    // A connection the operator makes on upload-post appears here on the factory's next
    // cache refresh (a posting cycle) - the cockpit shows it without any wiring step.
    connections: connectionsRes?.connections || [],
    tracking: distillTracking(trackingRes),
    generatedAt: new Date().toISOString(),
  };
}

/**
 * The composite live-factory status, memoized ~6s so a busy cockpit + the heartbeat
 * tick + the research digest all share one read. Never throws.
 */
export function readFactoryStatus(): Promise<FactoryStatus> {
  if (statusCache && Date.now() - statusCache.at < CACHE_TTL_MS) return statusCache.value;
  const value = buildStatus().catch(() => offline("The clip factory read failed."));
  statusCache = { at: Date.now(), value };
  return value;
}

const VALID_TASKS: readonly FactoryTask[] = ["viral", "generate", "post", "collect"];

/**
 * Ask the factory to run one of its own already-safe local scripts. These are the
 * SAME tasks its scheduled tasks run (fill viral clips, generate, post due clips,
 * refresh live URLs) — the bridge just triggers them on demand. Gated at the route.
 */
export async function runFactoryTask(
  task: string,
): Promise<{ ok: boolean; reason?: string; runs?: Record<string, FactoryRun> }> {
  if (!factoryConfigured()) return { ok: false, reason: "The factory is not reachable from the public edge." };
  if (!VALID_TASKS.includes(task as FactoryTask)) return { ok: false, reason: `Unknown task: ${task}` };
  const r = await hubPost<{ started?: boolean; error?: string; runs?: Record<string, FactoryRun> }>("/api/run", { task });
  statusCache = null;
  if (!r) return { ok: false, reason: "The local clip factory is not running." };
  if (r.error) return { ok: false, reason: r.error };
  return { ok: true, runs: r.runs };
}

/** Arm or disarm the factory's autopost loop. */
export async function setFactoryArmed(armed: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (!factoryConfigured()) return { ok: false, reason: "The factory is not reachable from the public edge." };
  const r = await hubPost<unknown>("/api/settings", { armed: !!armed });
  statusCache = null;
  if (!r) return { ok: false, reason: "The local clip factory is not running." };
  return { ok: true };
}

/** Mark posted clips submitted / unsubmitted in the factory's payout queue. */
export async function markFactorySubmitted(
  clips: string[],
  submitted: boolean,
): Promise<{ ok: boolean; reason?: string; updated?: number }> {
  if (!factoryConfigured()) return { ok: false, reason: "The factory is not reachable from the public edge." };
  const r = await hubPost<{ updated?: number }>("/api/submissions/mark", { clips, submitted });
  statusCache = null;
  if (!r) return { ok: false, reason: "The local clip factory is not running." };
  return { ok: true, updated: r.updated ?? 0 };
}
