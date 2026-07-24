import "server-only";

import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { env } from "@/lib/core/env";
import type { PromoPost, PromoRailStatus, PromoStagedGame } from "@/types/roblox-creator";

/**
 * lib/roblox/creator/promo.ts — the ZERO-COST promo rail for the operator's own games.
 *
 * The local clip factory (BertClipsHub) already turns gameplay recordings dropped into
 * roblox-promo\raw\<slug>\ into short-form promo clips and posts them on the BuiltByBert
 * accounts. This module surfaces that rail per game: what is staged, what has posted,
 * and how many views the posts earned. Reads are read-only against the factory's own
 * ledgers (posted.json / views.json); the only write is creating a game's drop folder.
 * Local desktop host only — offline-graceful everywhere else. Never throws.
 */

const PROMO_PROFILE = "builtbybert";
const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi"]);

function hubRoot(): string {
  const fromEnv = (process.env.BERTCLIPS_DIR || "").trim();
  return fromEnv || path.join(os.homedir(), "BertClipsHub");
}

function promoRawRoot(): string {
  return path.join(hubRoot(), "roblox-promo", "raw");
}

async function readJsonFile<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

function offline(reason: string): PromoRailStatus {
  return { available: false, reason, staged: [], posts: [], totals: { posts: 0, views: 0 } };
}

async function stagedGames(): Promise<PromoStagedGame[]> {
  const root = promoRawRoot();
  if (!existsSync(root)) return [];
  const out: PromoStagedGame[] = [];
  try {
    const entries = await readdir(root, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      let rawClips = 0;
      try {
        const files = await readdir(path.join(root, e.name));
        rawClips = files.filter((f) => VIDEO_EXTS.has(path.extname(f).toLowerCase())).length;
      } catch {
        // unreadable folder: report it with zero clips
      }
      out.push({ slug: e.name, rawClips });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

interface PostedEntry {
  at?: string;
  platforms?: string[];
  profile?: string;
  url?: string;
}
interface ViewEntry {
  views?: number;
  url?: string;
}

async function promoPosts(): Promise<PromoPost[]> {
  const posted = await readJsonFile<Record<string, PostedEntry>>(path.join(hubRoot(), "posted.json"));
  if (!posted) return [];
  const views = (await readJsonFile<Record<string, ViewEntry>>(path.join(hubRoot(), "views.json"))) || {};
  const out: PromoPost[] = [];
  for (const [clip, entry] of Object.entries(posted)) {
    if ((entry.profile || "").toLowerCase() !== PROMO_PROFILE) continue;
    const v = views[clip];
    out.push({
      clip,
      profile: entry.profile || "",
      platforms: Array.isArray(entry.platforms) ? entry.platforms : [],
      at: entry.at || "",
      views: typeof v?.views === "number" ? v.views : 0,
      url: v?.url || entry.url,
    });
  }
  return out.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
}

/** The promo rail status for the creator cockpit. */
export async function readPromoRailStatus(): Promise<PromoRailStatus> {
  if (env.deploymentMode() !== "local") {
    return offline("The promo rail runs on the local desktop host, not the public edge.");
  }
  if (!existsSync(hubRoot())) {
    return offline("The local clip factory (BertClipsHub) is not on this host.");
  }
  const [staged, posts] = await Promise.all([stagedGames(), promoPosts()]);
  return {
    available: true,
    dropPath: promoRawRoot(),
    staged,
    posts,
    totals: {
      posts: posts.length,
      views: posts.reduce((t, p) => t + p.views, 0),
    },
  };
}

const SLUG_RE = /[^a-z0-9-]/g;

/**
 * Stage a game on the promo rail: create its raw-gameplay drop folder (with a short
 * instruction file) so recordings dropped there start becoming promo clips. Creates
 * only — never deletes or overwrites recordings.
 */
export async function promoteGame(name: string): Promise<{ ok: boolean; reason?: string; dropPath?: string }> {
  if (env.deploymentMode() !== "local") {
    return { ok: false, reason: "The promo rail runs on the local desktop host only." };
  }
  if (!existsSync(hubRoot())) {
    return { ok: false, reason: "The local clip factory (BertClipsHub) is not on this host." };
  }
  const slug = String(name || "").trim().toLowerCase().replace(/\s+/g, "-").replace(SLUG_RE, "").slice(0, 60);
  if (!slug) return { ok: false, reason: "Give the game a name first." };
  const dir = path.join(promoRawRoot(), slug);
  try {
    await mkdir(dir, { recursive: true });
    const readme = path.join(dir, "DROP-GAMEPLAY-HERE.txt");
    if (!existsSync(readme)) {
      await writeFile(
        readme,
        [
          `Promo rail drop folder for: ${slug}`,
          "",
          "Drop gameplay recordings (.mp4/.mov) of this game into this folder.",
          "The clip factory turns them into short promo clips and posts them on",
          "the BuiltByBert accounts automatically. Longer raw footage works best;",
          "the factory picks the highlights.",
          "",
        ].join("\n"),
        "utf8",
      );
    }
    return { ok: true, dropPath: dir };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Could not create the drop folder." };
  }
}
