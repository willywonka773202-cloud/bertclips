import "server-only";

import { randomUUID } from "node:crypto";

import { readJson, updateJson } from "@/lib/core/storage";
import type {
  Clip,
  ClipChannel,
  ClipPlatform,
  ClipPost,
  ClipSource,
  ClipStatus,
  ClippingCampaign,
  ClippingConfig,
  ClippingEarningsSummary,
  ClippingStore,
  EarningsEntry,
  GamePromo,
  GamePromoPhase,
} from "@/types/clipping";

/**
 * lib/clipping/store.ts — the single atomic JSON store for the Clipping subsystem
 * (config + campaigns + sources + clips + channels + the cash-truth earnings ledger).
 *
 * Reads are fail-soft (missing/corrupt file -> normalized defaults). Every mutation
 * goes through `updateJson`, which serializes read-modify-write per file so two
 * concurrent writers can't lose each other's updates. The earnings LEDGER is the one
 * source of truth for money — the Money Hub reads it, never the clips' own numbers.
 */

const STORE = "clipping";

const DEFAULT_CONFIG: ClippingConfig = {
  armed: false,
  killSwitch: false,
  autoResearch: false,
  autoGenerate: false,
  autoPost: false,
  autoApproveMinScore: 0,
  premiumRenderEnabled: false,
  defaultAspect: "9:16",
  // Poppins ExtraBold: a clean, rounded, modern caption face (bundled in
  // scripts/clipping/fonts, loaded via ffmpeg fontsdir); system fallback if absent.
  defaultSubtitleFont: "Poppins",
  defaultClipsPerSource: 4,
  caps: {
    maxClipsPerDay: 40,
    maxRendersPerDay: 12,
    maxSourceMinutes: 240,
    maxClipsPerSource: 12,
  },
  intervalMinutes: 180,
};

function localDay(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function emptyStore(): ClippingStore {
  return {
    config: DEFAULT_CONFIG,
    campaigns: [],
    gamePromos: [],
    sources: [],
    clips: [],
    channels: [],
    earnings: [],
    counters: { day: localDay(), clips: 0, renders: 0 },
    updatedAt: new Date().toISOString(),
  };
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function normalizeConfig(raw: Partial<ClippingConfig> | undefined): ClippingConfig {
  const c = raw ?? {};
  const caps = c.caps ?? DEFAULT_CONFIG.caps;
  return {
    armed: c.armed === true,
    killSwitch: c.killSwitch === true,
    autoResearch: c.autoResearch === true,
    autoGenerate: c.autoGenerate === true,
    autoPost: c.autoPost === true,
    autoApproveMinScore: Math.max(0, Math.min(100, Math.round(num(c.autoApproveMinScore, 0)))),
    premiumRenderEnabled: c.premiumRenderEnabled === true,
    defaultAspect: c.defaultAspect ?? DEFAULT_CONFIG.defaultAspect,
    defaultSubtitleFont: c.defaultSubtitleFont || DEFAULT_CONFIG.defaultSubtitleFont,
    defaultClipsPerSource: Math.max(1, Math.min(20, Math.round(num(c.defaultClipsPerSource, DEFAULT_CONFIG.defaultClipsPerSource)))),
    caps: {
      maxClipsPerDay: Math.max(1, Math.round(num(caps.maxClipsPerDay, DEFAULT_CONFIG.caps.maxClipsPerDay))),
      maxRendersPerDay: Math.max(1, Math.round(num(caps.maxRendersPerDay, DEFAULT_CONFIG.caps.maxRendersPerDay))),
      maxSourceMinutes: Math.max(1, Math.round(num(caps.maxSourceMinutes, DEFAULT_CONFIG.caps.maxSourceMinutes))),
      maxClipsPerSource: Math.max(1, Math.min(20, Math.round(num(caps.maxClipsPerSource, DEFAULT_CONFIG.caps.maxClipsPerSource)))),
    },
    intervalMinutes: Math.max(15, Math.min(1440, Math.round(num(c.intervalMinutes, DEFAULT_CONFIG.intervalMinutes)))),
  };
}

const PROMO_SLUG_RE = /[^a-z0-9-]/g;

/** The connected upload-post profile that posts promo clips — must match PROMO_PROFILE
 *  in lib/roblox/creator/promo.ts (the factory's promo posting profile). */
const DEFAULT_PROMO_PROFILE = "builtbybert";
/** The platforms the promo profile is connected on (upload-post: TikTok / Instagram / X). */
const DEFAULT_PROMO_PLATFORMS: ClipPlatform[] = ["tiktok", "instagram", "x"];

/** Derive the factory drop-folder slug from a game name (matches lib/roblox/creator/promo.ts). */
export function slugifyGame(name: string): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(PROMO_SLUG_RE, "")
    .slice(0, 60);
}

function normalizePhase(v: unknown): GamePromoPhase {
  return v === "launch" ? "launch" : "progress";
}

/** A promo is the operator's OWN game — free-first by construction: it carries NO CPM/pay
 *  field, so it can never route to a paid lane. Phase defaults to "progress" (never
 *  "launch" unless explicitly graduated). */
function normalizePromo(raw: Partial<GamePromo> | undefined): GamePromo {
  const p = raw ?? {};
  const game = typeof p.game === "string" ? p.game : "";
  const targets = Array.isArray(p.targetPlatforms)
    ? p.targetPlatforms.filter((t): t is ClipPlatform => t === "tiktok" || t === "instagram" || t === "youtube" || t === "x")
    : [];
  return {
    id: typeof p.id === "string" && p.id ? p.id : newId("promo"),
    game,
    slug: typeof p.slug === "string" && p.slug ? p.slug : slugifyGame(game),
    robloxAccount: typeof p.robloxAccount === "string" && p.robloxAccount.trim() ? p.robloxAccount.trim() : undefined,
    gameUrl: typeof p.gameUrl === "string" && p.gameUrl.trim() ? p.gameUrl.trim() : undefined,
    universeId: typeof p.universeId === "string" && p.universeId.trim() ? p.universeId.trim() : undefined,
    phase: normalizePhase(p.phase),
    postProfile: typeof p.postProfile === "string" && p.postProfile.trim() ? p.postProfile.trim() : DEFAULT_PROMO_PROFILE,
    targetPlatforms: targets.length ? targets : DEFAULT_PROMO_PLATFORMS,
    cta: typeof p.cta === "string" && p.cta.trim() ? p.cta.trim() : undefined,
    active: p.active !== false,
    addedAt: typeof p.addedAt === "string" ? p.addedAt : new Date().toISOString(),
    note: typeof p.note === "string" && p.note.trim() ? p.note.trim() : undefined,
  };
}

function normalizeStore(raw: Partial<ClippingStore> | null): ClippingStore {
  const s = raw ?? {};
  const base = emptyStore();
  const counters = s.counters ?? base.counters;
  const today = localDay();
  return {
    config: normalizeConfig(s.config),
    campaigns: Array.isArray(s.campaigns) ? s.campaigns : [],
    gamePromos: Array.isArray(s.gamePromos) ? s.gamePromos.map(normalizePromo) : [],
    sources: Array.isArray(s.sources) ? s.sources : [],
    clips: Array.isArray(s.clips) ? s.clips : [],
    channels: Array.isArray(s.channels) ? s.channels : [],
    earnings: Array.isArray(s.earnings) ? s.earnings : [],
    // Reset the per-day counters when the local day has rolled over.
    counters:
      counters.day === today
        ? { day: today, clips: num(counters.clips, 0), renders: num(counters.renders, 0) }
        : { day: today, clips: 0, renders: 0 },
    lastResearchAt: typeof s.lastResearchAt === "string" ? s.lastResearchAt : undefined,
    lastRecommendation: typeof s.lastRecommendation === "string" ? s.lastRecommendation : undefined,
    lastProduceAt: typeof s.lastProduceAt === "string" ? s.lastProduceAt : undefined,
    lastProduceNote: typeof s.lastProduceNote === "string" ? s.lastProduceNote : undefined,
    lastError: typeof s.lastError === "string" ? s.lastError : undefined,
    updatedAt: typeof s.updatedAt === "string" ? s.updatedAt : base.updatedAt,
  };
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`;
}

/** Read the whole store, normalized + day-rolled. Never throws. */
export async function readClippingStore(): Promise<ClippingStore> {
  return normalizeStore(await readJson<ClippingStore>(STORE, emptyStore()));
}

/** Serialized read-modify-write. `updater` returns the next store (or mutates + returns). */
async function mutate(updater: (s: ClippingStore) => ClippingStore): Promise<ClippingStore> {
  return updateJson<ClippingStore>(STORE, emptyStore(), (cur) => {
    const next = updater(normalizeStore(cur));
    next.updatedAt = new Date().toISOString();
    return next;
  });
}

// ── Config ────────────────────────────────────────────────────────────────
export async function getClippingConfig(): Promise<ClippingConfig> {
  return (await readClippingStore()).config;
}

export async function setClippingConfig(patch: Partial<ClippingConfig>): Promise<ClippingConfig> {
  const next = await mutate((s) => {
    s.config = normalizeConfig({ ...s.config, ...patch, caps: { ...s.config.caps, ...(patch.caps ?? {}) } });
    return s;
  });
  return next.config;
}

// ── Campaigns ───────────────────────────────────────────────────────────────
export async function addCampaign(input: Omit<ClippingCampaign, "id" | "addedAt" | "active"> & { active?: boolean }): Promise<ClippingCampaign> {
  const campaign: ClippingCampaign = {
    ...input,
    id: newId("camp"),
    active: input.active !== false,
    addedAt: new Date().toISOString(),
  };
  await mutate((s) => {
    s.campaigns = [campaign, ...s.campaigns];
    return s;
  });
  return campaign;
}

export async function updateCampaign(id: string, patch: Partial<ClippingCampaign>): Promise<void> {
  await mutate((s) => {
    s.campaigns = s.campaigns.map((c) => (c.id === id ? { ...c, ...patch, id: c.id } : c));
    return s;
  });
}

export async function removeCampaign(id: string): Promise<void> {
  await mutate((s) => {
    s.campaigns = s.campaigns.filter((c) => c.id !== id);
    return s;
  });
}

// ── Game promos (the operator's OWN games, promoted through clips) ────────────
/** Register a game promo. Free-first by construction: a promo never carries a CPM.
 *  Phase opens at "progress" unless explicitly graduated; the slug bridges the local
 *  factory drop folder so gameplay recordings become promo clips. */
export async function addGamePromo(
  input: Omit<GamePromo, "id" | "addedAt" | "active" | "slug"> & { active?: boolean; slug?: string },
): Promise<GamePromo> {
  const promo = normalizePromo({
    ...input,
    id: newId("promo"),
    slug: input.slug || slugifyGame(input.game),
    addedAt: new Date().toISOString(),
  });
  await mutate((s) => {
    s.gamePromos = [promo, ...s.gamePromos];
    return s;
  });
  return promo;
}

export async function updateGamePromo(id: string, patch: Partial<GamePromo>): Promise<void> {
  await mutate((s) => {
    s.gamePromos = s.gamePromos.map((p) => (p.id === id ? normalizePromo({ ...p, ...patch, id: p.id }) : p));
    return s;
  });
}

export async function removeGamePromo(id: string): Promise<void> {
  await mutate((s) => {
    s.gamePromos = s.gamePromos.filter((p) => p.id !== id);
    return s;
  });
}

// ── Sources ───────────────────────────────────────────────────────────────
export async function addSource(input: { url: string; kind?: ClipSource["kind"]; title?: string; campaignId?: string | null; gamePromoId?: string | null; clipsRequested?: number }): Promise<ClipSource> {
  const kind: ClipSource["kind"] = input.kind ?? (/(twitch\.tv)/i.test(input.url) ? "twitch" : "youtube");
  const source: ClipSource = {
    id: newId("src"),
    url: input.url,
    kind,
    title: input.title,
    campaignId: input.campaignId ?? null,
    gamePromoId: input.gamePromoId ?? null,
    status: "pending",
    addedAt: new Date().toISOString(),
    clipsRequested: input.clipsRequested,
  };
  await mutate((s) => {
    s.sources = [source, ...s.sources];
    return s;
  });
  return source;
}

export async function updateSource(id: string, patch: Partial<ClipSource>): Promise<void> {
  await mutate((s) => {
    s.sources = s.sources.map((x) => (x.id === id ? { ...x, ...patch, id: x.id } : x));
    return s;
  });
}

export async function removeSource(id: string): Promise<void> {
  await mutate((s) => {
    s.sources = s.sources.filter((x) => x.id !== id);
    return s;
  });
}

// ── Clips ─────────────────────────────────────────────────────────────────
export async function addClips(clips: Clip[]): Promise<void> {
  if (!clips.length) return;
  await mutate((s) => {
    s.clips = [...clips, ...s.clips];
    s.counters.clips += clips.length;
    return s;
  });
}

export async function updateClip(id: string, patch: Partial<Clip>): Promise<void> {
  await mutate((s) => {
    s.clips = s.clips.map((c) => (c.id === id ? { ...c, ...patch, id: c.id, updatedAt: new Date().toISOString() } : c));
    return s;
  });
}

export async function setClipStatus(id: string, status: ClipStatus): Promise<void> {
  await updateClip(id, { status });
}

/** Record a real post + (optionally) its earnings — the clip becomes "posted" and,
 *  when earnings are given, a cash-truth ledger entry is appended atomically. */
export async function recordClipPost(id: string, post: ClipPost): Promise<void> {
  await mutate((s) => {
    const clip = s.clips.find((c) => c.id === id);
    if (!clip) return s;
    clip.posts = [...(clip.posts ?? []), { ...post, postedAt: post.postedAt ?? new Date().toISOString() }];
    clip.status = "posted";
    clip.updatedAt = new Date().toISOString();
    if (typeof post.earnedUsd === "number" && post.earnedUsd !== 0) {
      s.earnings = [
        {
          id: newId("earn"),
          dateISO: localDay(),
          amountUsd: post.earnedUsd,
          source: clip.campaignId ? "campaign" : "organic",
          clipId: clip.id,
          campaignId: clip.campaignId ?? null,
          platform: post.platform,
          views: post.views ?? null,
          note: `Clip "${clip.title}" on ${post.platform}`,
          createdAt: new Date().toISOString(),
        },
        ...s.earnings,
      ];
    }
    return s;
  });
}

// ── Earnings ledger ─────────────────────────────────────────────────────────
export async function addEarning(input: Omit<EarningsEntry, "id" | "createdAt" | "dateISO"> & { dateISO?: string }): Promise<EarningsEntry> {
  const entry: EarningsEntry = {
    ...input,
    id: newId("earn"),
    dateISO: input.dateISO ?? localDay(),
    createdAt: new Date().toISOString(),
  };
  await mutate((s) => {
    s.earnings = [entry, ...s.earnings];
    return s;
  });
  return entry;
}

// ── Channels ────────────────────────────────────────────────────────────────
export async function addChannel(input: Omit<ClipChannel, "id" | "addedAt">): Promise<ClipChannel> {
  const channel: ClipChannel = { ...input, id: newId("chan"), addedAt: new Date().toISOString() };
  await mutate((s) => {
    s.channels = [channel, ...s.channels];
    return s;
  });
  return channel;
}

export async function removeChannel(id: string): Promise<void> {
  await mutate((s) => {
    s.channels = s.channels.filter((c) => c.id !== id);
    return s;
  });
}

// ── Counters (cap enforcement) ───────────────────────────────────────────────
export async function bumpRenderCount(): Promise<void> {
  await mutate((s) => {
    s.counters.renders += 1;
    return s;
  });
}

export async function noteResearch(input: { recommendation?: string; error?: string }): Promise<void> {
  await mutate((s) => {
    s.lastResearchAt = new Date().toISOString();
    if (input.recommendation !== undefined) s.lastRecommendation = input.recommendation;
    s.lastError = input.error;
    return s;
  });
}

/** Record a producer pass. `touchClock` stamps lastProduceAt (used to gate cadence so
 *  a long render can't re-enter); the note is a human-readable outcome line. */
export async function noteProduce(input: { note?: string; touchClock?: boolean }): Promise<void> {
  await mutate((s) => {
    if (input.touchClock !== false) s.lastProduceAt = new Date().toISOString();
    if (input.note !== undefined) s.lastProduceNote = input.note;
    return s;
  });
}

// ── Earnings summary (cash truth for the Money Hub + cockpit) ─────────────────
export function summarizeEarnings(store: ClippingStore): ClippingEarningsSummary {
  const today = localDay();
  const weekAgo = localDay(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
  let todayUsd = 0;
  let last7Usd = 0;
  let lifetimeUsd = 0;
  for (const e of store.earnings) {
    lifetimeUsd += e.amountUsd;
    if (e.dateISO === today) todayUsd += e.amountUsd;
    if (e.dateISO >= weekAgo) last7Usd += e.amountUsd;
  }
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const activeCampaigns = store.campaigns.filter((c) => c.active).length;
  const topPay = store.campaigns
    .filter((c) => c.active)
    .reduce<number | null>((max, c) => (max == null || c.payPerThousandUsd > max ? c.payPerThousandUsd : max), null);
  return {
    todayUsd: round2(todayUsd),
    last7Usd: round2(last7Usd),
    lifetimeUsd: round2(lifetimeUsd),
    clipsInReview: store.clips.filter((c) => c.status === "review").length,
    clipsApproved: store.clips.filter((c) => c.status === "approved").length,
    clipsPosted: store.clips.filter((c) => c.status === "posted").length,
    activeCampaigns,
    topPayPerThousandUsd: topPay,
    updatedAt: store.updatedAt,
  };
}

/** Platform display labels — used by the cockpit + notes. */
export const PLATFORM_LABEL: Record<ClipPlatform, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
};
