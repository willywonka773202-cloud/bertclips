import type { FactoryAccount, FactoryScheduleAccount } from "@/types/clipping";

/**
 * lib/clipping/platform-rows.ts — split one posting PROFILE into a row per
 * connected platform for the cockpit.
 *
 * upload-post fans one profile out to several platforms (TikTok / YouTube / X /
 * Instagram), so the factory reports a profile's followers/impressions as an
 * AGGREGATE — those stay on the card header. What IS real per-platform is the
 * @handle (from the analytics feed) and today's cadence (from the schedule
 * feed); this merges those two so the operator sees each platform account
 * separated, with only honest per-platform numbers.
 */

const LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  twitter: "X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
};

/** Human label for a factory platform key (unknowns are capitalized as-is). */
export function platformLabel(platform: string): string {
  const key = platform.toLowerCase();
  return LABELS[key] ?? (platform ? platform.charAt(0).toUpperCase() + platform.slice(1) : platform);
}

/** Canonical platform key for filtering — folds the twitter/x alias together. */
export function normPlatform(platform: string): string {
  const key = platform.toLowerCase();
  return key === "twitter" ? "x" : key;
}

export interface PlatformRow {
  /** Raw platform key from the factory, e.g. "tiktok". */
  platform: string;
  label: string;
  /** Real @handle on this platform, when the factory knows it. */
  handle: string | null;
  /** Posts made to this platform today, and the per-day cap (null = no schedule). */
  postedToday: number;
  perDay: number | null;
  atCap: boolean;
  needsReauth: boolean;
}

/** One row per platform a profile posts to, cadence + handle merged in. */
export function platformRows(
  account: FactoryAccount,
  schedule: FactoryScheduleAccount[],
): PlatformRow[] {
  const sched = schedule.find((s) => s.profile === account.profile);
  const byPlatform = new Map(
    (sched?.platforms || []).map((p) => [p.platform.toLowerCase(), p]),
  );
  const reauth = new Set(account.reauth.map((r) => r.toLowerCase()));
  return account.platforms.map((platform) => {
    const key = platform.toLowerCase();
    const s = byPlatform.get(key);
    return {
      platform,
      label: platformLabel(platform),
      handle: account.handles[platform] ?? account.handles[key] ?? null,
      postedToday: s ? s.postedToday.length : 0,
      perDay: s ? s.perDay : null,
      atCap: s ? s.atCap : false,
      needsReauth: reauth.has(key),
    };
  });
}
