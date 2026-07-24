/**
 * types/roblox-games.ts — the operator's Roblox GAMES LIBRARY.
 *
 * Separate from the game BUILDER (lib/roblox/* jobs): this is the curated set of the
 * operator's own games — uploaded templates, self-made games, and generated builds —
 * each with its OWN persistent folder + canonical .rbxl (so a click opens it in Studio
 * and edits save back to the same file). When a game is published to Roblox it gets a
 * universeId, which lights up LIVE analytics (CCU, visits, favorites, votes) from the
 * public games API. An optional Open Cloud key (server-only, never returned) unlocks
 * revenue/retention later.
 */

export type RobloxGameSource = "upload" | "made" | "built" | "flip";

/** One game in the operator's library. */
export interface LibraryGame {
  id: string;
  name: string;
  /** Folder name under the library root — its own persistent home on disk. */
  slug: string;
  /** Canonical .rbxl path (in the game's own folder). Opened in Studio; edits save here. */
  rbxlPath?: string;
  source: RobloxGameSource;
  /** Published-experience link for live analytics (absent until published to Roblox). */
  universeId?: string;
  placeId?: string;
  addedAt: string;
  note?: string;
}

export interface RobloxGamesConfig {
  /** Optional Open Cloud API key for future revenue/retention metrics. Server-only. */
  openCloudApiKey?: string;
}

export interface RobloxGamesStore {
  games: LibraryGame[];
  config: RobloxGamesConfig;
  updatedAt: string;
}

/** Live public stats for one published experience. */
export interface RobloxGameStat {
  universeId: string;
  placeId: string;
  name: string;
  iconUrl?: string;
  creatorName?: string;
  playing: number;
  visits: number;
  favoritedCount: number;
  upVotes: number;
  downVotes: number;
  maxPlayers: number;
  created?: string;
  updated?: string;
  url: string;
}

/** A library game merged with its on-disk + live-stats state, for the cockpit. */
export interface RobloxGamesSnapshotGame extends LibraryGame {
  /** Whether the canonical .rbxl exists on the host (openable in Studio). */
  hasFile: boolean;
  /** Live public stats when published (has a universeId). */
  stat?: RobloxGameStat;
}

/** The read-only cockpit view served by GET /api/roblox/games. */
export interface RobloxGamesSnapshot {
  /** Whether the Roblox public API was reachable this pull (for published games). */
  online: boolean;
  reason?: string;
  games: RobloxGamesSnapshotGame[];
  totals: {
    games: number;
    published: number;
    playing: number;
    visits: number;
    favorites: number;
  };
  /** Whether an Open Cloud key is configured (the key itself is never returned). */
  hasOpenCloudKey: boolean;
  generatedAt: string;
}
