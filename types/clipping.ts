/**
 * types/clipping.ts — the shape of the Clipping income subsystem.
 *
 * BERT AI turns long-form source video (YouTube / Twitch VODs) into short vertical
 * clips for TikTok / Reels / Shorts / X, tracks the paid clipping CAMPAIGNS that pay
 * per 1,000 verified views, and keeps a cash-truth earnings ledger that feeds the
 * Money Hub. The generation engine (yt-dlp + whisper + ffmpeg) is FREE and local by
 * default; the paid render lane and public posting are explicit, gated actions.
 *
 * AUTONOMY (opt-in, OFF by default): the research loop is free-first and only
 * discovers/ranks. The optional PRODUCER loop (config.autoGenerate) uses only the FREE
 * local engine to generate + stage clips from queued sources — it never touches the
 * paid Higgsfield lane. Public POSTING is an outward, hard-to-undo action: it stays
 * inert until a posting rail is connected (lib/clipping/poster.ts) and only runs when
 * config.autoPost is armed — exactly like a paper->live trading venue.
 */

export type ClipStatus =
  | "queued"
  | "rendering"
  | "review"
  | "approved"
  | "posted"
  | "rejected"
  | "failed";

export type ClipPlatform = "tiktok" | "instagram" | "youtube" | "x";
export type ClipAspect = "9:16" | "1:1" | "16:9";
export type ClipEngine = "local" | "higgsfield";
export type SourceKind = "youtube" | "twitch" | "file";
export type SourceStatus = "pending" | "clipping" | "done" | "failed";
export type EarningsSource = "campaign" | "organic" | "manual";

/** A paid clipping campaign (e.g. a Whop Content Reward) that pays per 1k views. */
export interface ClippingCampaign {
  id: string;
  name: string;
  /** Who runs the campaign / whose content is being clipped. */
  creator?: string;
  /** Where the campaign is hosted ("Whop", "direct", ...). */
  platform: string;
  /** Where the source VODs come from (channel, podcast, stream). */
  sourceHint?: string;
  /** CPM — dollars paid per 1,000 verified views. */
  payPerThousandUsd: number;
  /** Remaining budget, when known (campaigns cap total spend). */
  budgetRemainingUsd?: number | null;
  /** Minimum views before a clip pays out, when the campaign sets one. */
  minPayoutViews?: number | null;
  /** Which platforms the campaign accepts posts on. */
  targetPlatforms: ClipPlatform[];
  requirements?: string;
  link?: string;
  active: boolean;
  addedAt: string;
  note?: string;
}

/** Which stage of a game's promo life a clip is selling. */
export type GamePromoPhase = "progress" | "launch";

/**
 * A promo target: one of the operator's OWN games being promoted through clips — the
 * inverse of a paid campaign. There is no CPM here; the payoff is the game's growth.
 * The source footage is the operator's own gameplay (their Roblox account, connected
 * later). A promo opens in the "progress" phase (dev-hype clips of the game coming
 * together) and graduates to "launch" (release ads) when the game fully ships. It is
 * registered now so the command center tracks it and the local factory drop folder
 * exists; the Roblox + posting accounts wire in later without changing anything here.
 */
export interface GamePromo {
  id: string;
  /** Game name, e.g. "Punch Simulator". */
  game: string;
  /** Drop-folder slug under the local factory's roblox-promo\raw — bridges the rail. */
  slug: string;
  /** The operator's Roblox account/handle whose gameplay is clipped (connect later). */
  robloxAccount?: string;
  /** Published-experience link used for the CTA (absent until the game is published). */
  gameUrl?: string;
  universeId?: string;
  /** progress = dev-hype now; launch = release ads. Starts at "progress". */
  phase: GamePromoPhase;
  /** The connected upload-post profile that posts this promo's clips. Defaults to
   *  "builtbybert" — the factory's promo posting profile (TikTok / Instagram / X). */
  postProfile?: string;
  /** Where promo clips are posted (the connected accounts' platforms). */
  targetPlatforms: ClipPlatform[];
  /** Pinned CTA line for captions ("Play Punch Simulator now"). */
  cta?: string;
  active: boolean;
  addedAt: string;
  note?: string;
}

/** A long-form source video queued to be clipped. */
export interface ClipSource {
  id: string;
  url: string;
  kind: SourceKind;
  title?: string;
  campaignId?: string | null;
  /** Set when the source is the operator's own gameplay for a game promo (not a paid campaign). */
  gamePromoId?: string | null;
  status: SourceStatus;
  addedAt: string;
  clipsRequested?: number;
  /** Human progress line while the engine runs ("transcribing", "rendering 2/6"). */
  progress?: string;
  error?: string;
}

/** An actual public post of a clip, with the views/earnings it produced. */
export interface ClipPost {
  platform: ClipPlatform;
  url?: string;
  views?: number;
  earnedUsd?: number;
  postedAt?: string;
}

/** One generated clip, from raw render through review to posted + measured. */
export interface Clip {
  id: string;
  sourceId: string;
  sourceUrl: string;
  campaignId?: string | null;
  title: string;
  /** The scroll-stopping hook / caption line. */
  hook: string;
  transcriptExcerpt?: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  /** 0-100 predicted virality (hook, emotion, conflict, quotable, payoff). */
  viralityScore: number;
  reasons: string[];
  aspect: ClipAspect;
  subtitleFont: string;
  engine: ClipEngine;
  status: ClipStatus;
  /** Absolute path to the rendered mp4 on the host (served via /api/clipping/media). */
  file?: string;
  hashtags: string[];
  /** Intended target platforms. */
  platforms: ClipPlatform[];
  /** Real posts with measured views + earnings (cash truth). */
  posts: ClipPost[];
  createdAt: string;
  updatedAt: string;
  error?: string;
}

/** A faceless posting channel we own (the hybrid organic side). */
export interface ClipChannel {
  id: string;
  handle: string;
  platform: ClipPlatform;
  niche?: string;
  followers?: number | null;
  note?: string;
  addedAt: string;
}

/** One line in the cash-truth earnings ledger. */
export interface EarningsEntry {
  id: string;
  /** The day (YYYY-MM-DD) the earnings are attributed to. */
  dateISO: string;
  amountUsd: number;
  source: EarningsSource;
  clipId?: string | null;
  campaignId?: string | null;
  channelId?: string | null;
  platform?: ClipPlatform | null;
  views?: number | null;
  note?: string;
  createdAt: string;
}

/** Hard caps — bound cost + volume so nothing runs away. */
export interface ClippingCaps {
  maxClipsPerDay: number;
  maxRendersPerDay: number;
  /** Refuse absurdly long VODs (protects CPU + disk). */
  maxSourceMinutes: number;
  maxClipsPerSource: number;
}

export interface ClippingConfig {
  /** Arms the autonomous (free) research loop. OFF by default. */
  armed: boolean;
  /** Hard stop for all autonomous activity. */
  killSwitch: boolean;
  /** The research loop refreshes campaigns + ranks sources when armed. */
  autoResearch: boolean;
  /** Arms the autonomous PRODUCER loop: generate + stage clips from queued sources
   *  using ONLY the free local engine. OFF by default. Requires `armed` too. */
  autoGenerate: boolean;
  /** Arms autonomous POSTING of approved clips. OFF by default and inert until a
   *  posting rail is connected — an outward, hard-to-undo action, so it is gated
   *  exactly like a live trading venue (capability present, dormant without creds). */
  autoPost: boolean;
  /** Auto-approve staged clips scoring at/above this virality (0-100) so they can flow
   *  to auto-post without a click. 0 disables auto-approval (every clip waits for a
   *  human). Only meaningful with autoGenerate; posting still needs autoPost + a rail. */
  autoApproveMinScore: number;
  /** Allow the PAID Higgsfield render lane (still a per-clip gated click). */
  premiumRenderEnabled: boolean;
  defaultAspect: ClipAspect;
  defaultSubtitleFont: string;
  defaultClipsPerSource: number;
  caps: ClippingCaps;
  /** Research loop cadence in minutes. */
  intervalMinutes: number;
}

/** Per-day counters for cap enforcement (reset when the local day rolls over). */
export interface ClippingCounters {
  day: string;
  clips: number;
  renders: number;
}

export interface ClippingStore {
  config: ClippingConfig;
  campaigns: ClippingCampaign[];
  /** The operator's own games being promoted through clips (progress hype -> launch ads). */
  gamePromos: GamePromo[];
  sources: ClipSource[];
  clips: Clip[];
  channels: ClipChannel[];
  earnings: EarningsEntry[];
  counters: ClippingCounters;
  lastResearchAt?: string;
  /** The most recent free-research recommendation (shown in the cockpit). */
  lastRecommendation?: string;
  /** When the autonomous producer last started a generation pass. */
  lastProduceAt?: string;
  /** Human-readable line describing the producer's last decision/outcome. */
  lastProduceNote?: string;
  lastError?: string;
  updatedAt: string;
}

/** Health of one free-engine binary (ffmpeg / yt-dlp / whisper / python). */
export interface DepStatus {
  id: "ffmpeg" | "ffprobe" | "python" | "yt-dlp" | "faster-whisper" | "opencv";
  label: string;
  ok: boolean;
  version?: string;
  hint?: string;
  /** Optional deps enhance output (e.g. face-aware crop) but do NOT gate engineReady. */
  optional?: boolean;
}

export interface DepsReport {
  ok: boolean;
  /** True when the minimum set for a local render is present. */
  engineReady: boolean;
  deps: DepStatus[];
  checkedAt: string;
}

/** Read-only earnings roll-up — the cash-truth numbers the Money Hub + cockpit show. */
export interface ClippingEarningsSummary {
  todayUsd: number;
  last7Usd: number;
  lifetimeUsd: number;
  clipsInReview: number;
  clipsApproved: number;
  clipsPosted: number;
  activeCampaigns: number;
  /** Best CPM on the board — the ceiling on what a viral clip is worth. */
  topPayPerThousandUsd: number | null;
  updatedAt: string;
}

/** The full read-only cockpit view served by GET /api/clipping. */
export interface ClippingSnapshot {
  config: ClippingConfig;
  summary: ClippingEarningsSummary;
  campaigns: ClippingCampaign[];
  /** The operator's own game-promo targets (own-game clips, not paid campaigns). */
  gamePromos: GamePromo[];
  sources: ClipSource[];
  /** Clips that need a human decision (review + approved). */
  actionClips: Clip[];
  /** Recently posted / failed clips. */
  recentClips: Clip[];
  channels: ClipChannel[];
  /** Most recent ledger entries. */
  earnings: EarningsEntry[];
  deps: DepsReport;
  researchRunning: boolean;
  /** True while the autonomous producer is mid generation pass. */
  producerRunning: boolean;
  /** True when a real posting rail (creds) is connected, so auto-post can publish. */
  postingWired: boolean;
  lastResearchAt?: string;
  lastRecommendation?: string;
  lastProduceAt?: string;
  lastProduceNote?: string;
  lastError?: string;
  /** The LIVE local posting factory (BertClipsHub), when reachable. Offline-graceful. */
  factory?: FactoryStatus;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Live factory bridge — the running BertClipsHub operation on loopback :4477.
//
// The in-app engine above GENERATES + reviews clips; the factory is the separate
// local process that actually AUTO-POSTS to the real accounts on a schedule and
// holds the upload-post credential. The bridge (lib/clipping/factory-bridge.ts)
// reads the factory's operational state over loopback so the cockpit shows ONE
// pane: engine + ledger here, the live operation below. Everything is offline-
// graceful — on the public cloud edge there is no factory, so `online` is false.
// ---------------------------------------------------------------------------

/** One posting account in the live factory, merged from its ops + analytics feeds. */
export interface FactoryAccount {
  profile: string;
  prefix: string;
  /** Connected platforms (from upload-post) and the reauth-required subset. */
  platforms: string[];
  reauth: string[];
  /** Real @handle per platform (e.g. {tiktok: "@bertclips"}), when known. */
  handles: Record<string, string>;
  /** Public profile URL for the primary platform. */
  url?: string;
  /** Cumulative posts recorded for this profile. */
  posts: number;
  impressions: number;
  followers: number;
  lastPostAt: string | null;
  /** Buffer health: unposted clips ready vs the target buffer depth. */
  unposted: number;
  bufferTarget: number;
  /** Today's cadence against the daily cap. */
  postsToday: number;
  dailyCap: number;
  /** Epoch ms the account is next eligible to post, or null when already at cap. */
  nextEligibleAt: number | null;
  atCap: boolean;
}

export interface FactorySchedulePlatform {
  platform: string;
  perDay: number;
  gapMin: number;
  /** ISO timestamps already posted to this platform today. */
  postedToday: string[];
  nextAt: number | null;
  atCap: boolean;
}

export interface FactoryScheduleAccount {
  profile: string;
  prefix: string;
  platforms: FactorySchedulePlatform[];
}

export interface FactoryAlert {
  level: "ok" | "info" | "warn";
  msg: string;
}

export interface FactorySubmissionClip {
  clip: string;
  url: string;
  profile: string;
  postedAt: string | null;
  ageHours: number | null;
}

export interface FactorySubmissionProgram {
  campaign: string;
  pending: FactorySubmissionClip[];
  submitted: FactorySubmissionClip[];
  needsProgram: boolean;
}

export interface FactorySubmissions {
  programs: FactorySubmissionProgram[];
  totalPending: number;
  totalSubmitted: number;
  agingPending: number;
  needsProgram: number;
}

export interface FactoryRun {
  running: boolean;
  startedAt: number | null;
  endedAt: number | null;
  code: number | null;
  tail: string;
}

export interface FactoryTotals {
  accounts: number;
  posts: number;
  impressions: number;
  followers: number;
}

/** One upload-post connection the factory knows about (near-live cache). A profile
 *  the operator just connected shows here immediately; `routed:false` means it is
 *  connected but not yet wired to a program (the absorb loop or a human decision). */
export interface FactoryConnection {
  profile: string;
  platforms: string[];
  routed: boolean;
}

/** Distilled real per-post tracking (views ledger + learned lessons) from the factory. */
export interface FactoryTracking {
  /** Posts known to the ledger / posts with real numbers already. */
  posts: number;
  tracked: number;
  /** Sum of real tracked views across posts. */
  views: number;
  topClip: string | null;
  topViews: number;
  /** One-line distilled lesson (best duration band / hour), when enough data exists. */
  lesson: string | null;
}

/** The composite live-factory status the cockpit renders. Offline-graceful. */
export interface FactoryStatus {
  online: boolean;
  /** Why the factory is offline (cloud edge / process down), when it is. */
  reason?: string;
  /** Whether the factory's autopost loop is armed. */
  armed: boolean;
  accounts: FactoryAccount[];
  schedule: FactoryScheduleAccount[];
  submissions: FactorySubmissions;
  alerts: FactoryAlert[];
  activity: { scheduler: string[]; autopilot: string[] };
  runs: Record<string, FactoryRun>;
  totals: FactoryTotals;
  /** Every known upload-post connection (routed or not) - a just-connected account appears here. */
  connections: FactoryConnection[];
  /** Real per-post tracking + learned lessons, when the factory has them. */
  tracking: FactoryTracking | null;
  generatedAt: string;
}

/** The tasks the factory can be asked to run (its own already-safe local scripts). */
export type FactoryTask = "viral" | "generate" | "post" | "collect";
