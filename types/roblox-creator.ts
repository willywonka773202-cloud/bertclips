/**
 * types/roblox-creator.ts — the ROBLOX CREATOR cockpit: one dashboard that merges the
 * games library (with live public stats), a persisted stats HISTORY (growth over time),
 * the zero-cost clip-factory promo rail (BuiltByBert), and the Build Kit resource catalog.
 */

import type { RobloxGamesSnapshot } from "./roblox-games";

/** One persisted stats sample for a published game (heartbeat-collected). */
export interface CreatorStatPoint {
  /** ISO timestamp of the sample. */
  t: string;
  playing: number;
  visits: number;
  favorites: number;
  upVotes: number;
  downVotes: number;
}

/** Growth summary for one published game, derived from the history series. */
export interface CreatorGameTrend {
  universeId: string;
  /** Visits gained over the trailing 24h / 7d (0 when not enough history yet). */
  visits24h: number;
  visits7d: number;
  favorites7d: number;
  /** Down-sampled recent series for sparklines (oldest first). */
  spark: CreatorStatPoint[];
  firstSampleAt?: string;
  lastSampleAt?: string;
}

/** One clip the promo rail has posted for our own games (BuiltByBert). */
export interface PromoPost {
  clip: string;
  profile: string;
  platforms: string[];
  at: string;
  views: number;
  url?: string;
}

/** One game folder staged in the promo rail's raw-gameplay drop. */
export interface PromoStagedGame {
  slug: string;
  /** Video files waiting in raw\<slug>\ (source gameplay to be clipped). */
  rawClips: number;
}

/** The zero-cost promo rail status (clip factory, local host only). */
export interface PromoRailStatus {
  available: boolean;
  reason?: string;
  /** Absolute drop folder for gameplay recordings (raw\<slug>\). */
  dropPath?: string;
  staged: PromoStagedGame[];
  posts: PromoPost[];
  totals: { posts: number; views: number };
}

export type KitItemKind = "template" | "kit" | "repo" | "doc" | "snippet" | "asset";

/** One reusable resource in the Build Kit catalog. */
export interface KitItem {
  id: string;
  name: string;
  kind: KitItemKind;
  /** Local path (template .rbxl, kit module, doc) when the resource lives on the host. */
  path?: string;
  /** External URL (GitHub repo, doc) when it lives off-host. */
  url?: string;
  tags: string[];
  note?: string;
  addedAt: string;
  /** True for the built-in starter entries (still removable). */
  seeded?: boolean;
}

export interface BuildKitStore {
  items: KitItem[];
  updatedAt: string;
}

/** The whole creator cockpit view served by GET /api/roblox/creator. */
export interface RobloxCreatorSnapshot {
  games: RobloxGamesSnapshot;
  trends: Record<string, CreatorGameTrend>;
  promo: PromoRailStatus;
  kit: { items: KitItem[] };
  /** Autonomous build factory summary (armed, counters) for the overview strip. */
  factory: { armed: boolean; builds: number; staged: number } | null;
  historyLastRunAt?: string;
  generatedAt: string;
}
