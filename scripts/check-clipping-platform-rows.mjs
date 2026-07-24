import assert from "node:assert/strict";

import { platformRows, platformLabel, normPlatform } from "../lib/clipping/platform-rows.ts";

/**
 * Guard for the cockpit's separated per-platform account view
 * (lib/clipping/platform-rows.ts). It must split one upload-post profile into a
 * row per platform, merging the REAL @handle (analytics) with today's cadence
 * (schedule) — and never invent per-platform numbers the factory did not report.
 */

// Labels normalize, including the x/twitter alias, and pass unknowns through.
assert.equal(platformLabel("tiktok"), "TikTok");
assert.equal(platformLabel("twitter"), "X");
assert.equal(platformLabel("x"), "X");
assert.equal(platformLabel("mastodon"), "Mastodon");

// The filter key folds twitter -> x so "X" chip catches both.
assert.equal(normPlatform("twitter"), "x");
assert.equal(normPlatform("X"), "x");
assert.equal(normPlatform("TikTok"), "tiktok");

const account = {
  profile: "bertclips",
  prefix: "",
  platforms: ["tiktok", "youtube", "x"],
  reauth: ["X"], // case-insensitive vs the "x" platform key
  handles: { tiktok: "@bertclips", youtube: "@bertclipsYT" },
  posts: 10,
  impressions: 5000,
  followers: 100,
  lastPostAt: null,
  unposted: 3,
  bufferTarget: 6,
  postsToday: 2,
  dailyCap: 8,
  nextEligibleAt: null,
  atCap: false,
};

const schedule = [
  {
    profile: "bertclips",
    prefix: "",
    platforms: [
      { platform: "tiktok", perDay: 4, gapMin: 90, postedToday: ["t1", "t2"], nextAt: null, atCap: false },
      { platform: "youtube", perDay: 2, gapMin: 180, postedToday: ["y1", "y2"], nextAt: null, atCap: true },
    ],
  },
];

const rows = platformRows(account, schedule);
assert.equal(rows.length, 3, "one row per connected platform");

const [tiktok, youtube, x] = rows;

// Real handle + real cadence merge for platforms that are in the schedule.
assert.equal(tiktok.handle, "@bertclips");
assert.equal(tiktok.postedToday, 2);
assert.equal(tiktok.perDay, 4);
assert.equal(tiktok.atCap, false);
assert.equal(tiktok.needsReauth, false);

assert.equal(youtube.handle, "@bertclipsYT");
assert.equal(youtube.atCap, true, "youtube schedule says at cap");

// A platform with NO schedule entry gets null cadence, never a fabricated 0/N.
assert.equal(x.perDay, null, "no schedule for x -> perDay is null, not invented");
assert.equal(x.postedToday, 0);
assert.equal(x.handle, null, "no handle known for x");
assert.equal(x.needsReauth, true, "reauth 'X' matches platform 'x' case-insensitively");

console.log("check-clipping-platform-rows: OK");
