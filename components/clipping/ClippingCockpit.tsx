"use client";

import * as React from "react";
import {
  Scissors,
  Loader2,
  ShieldCheck,
  Power,
  Sparkles,
  Plus,
  Play,
  Check,
  X,
  Send,
  AlertTriangle,
  DollarSign,
  Radar,
  Gamepad2,
  Rocket,
} from "lucide-react";

import { apiGet, apiPost } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { FactoryPanel } from "./FactoryPanel";
import type {
  Clip,
  ClipPlatform,
  ClippingCampaign,
  ClippingSnapshot,
  GamePromo,
} from "@/types/clipping";

/**
 * ClippingCockpit — the read-and-act deck for the Clipping income subsystem, in the
 * warm BertClipsHub console theme. It renders /api/clipping and drives the gated actions: queue a
 * source, generate clips (free local engine), review/approve/reject, mark a clip posted
 * with its measured views + earnings (cash truth), and manage the paid campaign board.
 *
 * Free-first + gated: generation and posting are explicit clicks here; only the research
 * loop is autonomous, and only when armed. The earnings ledger is the money source of
 * truth and flows into the Money Hub.
 */

const PLATFORMS: ClipPlatform[] = ["tiktok", "instagram", "youtube", "x"];
const PLATFORM_LABEL: Record<ClipPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube", x: "X" };

function usd(v: number | null | undefined, signed = false): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const sign = signed ? (v >= 0 ? "+" : "-") : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function ClippingCockpit() {
  const [snap, setSnap] = React.useState<ClippingSnapshot | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      setSnap(await apiGet<ClippingSnapshot>("/api/clipping"));
    } catch {
      /* keep last */
    } finally {
      setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    void load();
    const t = window.setInterval(() => { if (!document.hidden) void load(); }, 8_000);
    return () => window.clearInterval(t);
  }, [load]);

  const act = React.useCallback(async (action: string, payload: Record<string, unknown> = {}) => {
    setBusy(action);
    try {
      const res = await apiPost<{ snapshot?: ClippingSnapshot }>("/api/clipping/action", { action, ...payload });
      if (res?.snapshot) setSnap(res.snapshot);
      else await load();
    } catch {
      /* ignore; next poll refreshes */
    } finally {
      setBusy(null);
    }
  }, [load]);

  const generate = React.useCallback(async (payload: Record<string, unknown>) => {
    setBusy("generate");
    try {
      const res = await apiPost<{ snapshot?: ClippingSnapshot }>("/api/clipping/generate", payload);
      if (res?.snapshot) setSnap(res.snapshot);
      else await load();
    } catch {
      /* ignore */
    } finally {
      setBusy(null);
    }
  }, [load]);

  if (!loaded && !snap) {
    return (
      <div className="flex h-full items-center justify-center gap-2 bg-[#0a0b10] text-[13px] text-[#ff6a3d]/60">
        <Loader2 className="h-4 w-4 animate-spin" /> spinning up the clip deck…
      </div>
    );
  }

  const s = snap;
  const cfg = s?.config;
  const sum = s?.summary;
  const armed = Boolean(cfg?.armed && !cfg?.killSwitch);

  return (
    <div
      className="h-full overflow-y-auto px-4 py-4 sm:px-6"
      style={{ background: "radial-gradient(1200px 600px at 80% -10%, rgba(255,106,61,0.06), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(52,216,160,0.05), transparent 55%), #0a0b10" }}
    >
      {/* Header */}
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-2 font-mono text-[12px] uppercase tracking-[0.24em] text-[#ff6a3d]">
          <Scissors className="h-4 w-4" /> Clipping
        </span>
        <span className="label-mono text-ink-ghost">FREE LOCAL ENGINE · CASH-TRUTH LEDGER</span>
        <span className="ml-auto flex items-center gap-3 text-[10px] text-ink-ghost">
          <button
            type="button"
            onClick={() => act("set-config", { config: { armed: !cfg?.armed } })}
            disabled={busy !== null || cfg?.killSwitch}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1 font-mono uppercase tracking-wide transition",
              armed ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-line/20 text-ink-ghost hover:text-ink-faint",
            )}
          >
            <Power className="h-3 w-3" /> {armed ? "armed" : "off"}
          </button>
          <button
            type="button"
            onClick={() => act("set-config", { config: { autoGenerate: !cfg?.autoGenerate } })}
            disabled={busy !== null || cfg?.killSwitch}
            title="Autonomously generate + stage clips from queued sources with the free local engine"
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1 font-mono uppercase tracking-wide transition",
              cfg?.autoGenerate && armed ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" : "border-line/20 text-ink-ghost hover:text-ink-faint",
            )}
          >
            auto-gen {cfg?.autoGenerate ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={() => act("set-config", { config: { autoPost: !cfg?.autoPost } })}
            disabled={busy !== null || cfg?.killSwitch}
            title="Auto-post approved clips (dormant until a posting rail is connected)"
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1 font-mono uppercase tracking-wide transition",
              cfg?.autoPost && armed ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-line/20 text-ink-ghost hover:text-ink-faint",
            )}
          >
            auto-post {cfg?.autoPost ? "on" : "off"}
          </button>
          <button
            type="button"
            onClick={() => act("set-config", { config: { killSwitch: !cfg?.killSwitch } })}
            disabled={busy !== null}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1 font-mono uppercase tracking-wide transition",
              cfg?.killSwitch ? "border-rose-400/50 bg-rose-500/15 text-rose-300" : "border-line/20 text-ink-ghost hover:text-rose-300",
            )}
          >
            <AlertTriangle className="h-3 w-3" /> {cfg?.killSwitch ? "killed" : "kill"}
          </button>
        </span>
      </div>

      {/* Earnings hero */}
      <div className="mx-auto mt-4 grid max-w-6xl gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Today · real cash" value={usd(sum?.todayUsd)} tone={(sum?.todayUsd ?? 0) > 0 ? "good" : "flat"} big />
        <Stat label="Last 7 days" value={usd(sum?.last7Usd)} />
        <Stat label="Lifetime" value={usd(sum?.lifetimeUsd)} />
        <Stat
          label="Clips"
          value={`${sum?.clipsInReview ?? 0} review · ${sum?.clipsPosted ?? 0} live`}
          sub={sum?.topPayPerThousandUsd != null ? `top CPM ${usd(sum.topPayPerThousandUsd)}/1k` : "add a paid campaign"}
        />
      </div>

      {/* Live posting factory — the running BertClipsHub operation, bridged in */}
      <div className="mx-auto mt-4 max-w-6xl">
        <FactoryPanel />
      </div>

      {/* Setup card when the engine isn't ready */}
      {s?.deps && !s.deps.engineReady ? <SetupCard deps={s.deps} /> : null}

      {/* Two columns: sources+generate | campaigns */}
      <div className="mx-auto mt-4 grid max-w-6xl gap-4 lg:grid-cols-[1fr_minmax(0,340px)]">
        <div className="flex flex-col gap-4">
          <SourcePanel snap={s} busy={busy} onGenerate={generate} onAct={act} engineReady={Boolean(s?.deps?.engineReady)} />
          <ReviewQueue clips={s?.actionClips ?? []} onAct={act} busy={busy} />
        </div>

        <div className="flex flex-col gap-4">
          <GamePromoPanel promos={s?.gamePromos ?? []} onAct={act} busy={busy} />
          <CampaignPanel campaigns={s?.campaigns ?? []} onAct={act} busy={busy} />
          <ProducerPanel snap={s} busy={busy} onAct={act} armed={armed} />
          <ResearchPanel snap={s} busy={busy} onAct={act} armed={armed} />
          <LedgerPanel snap={s} />
        </div>
      </div>

      {/* Honest footer */}
      <p className="mx-auto mt-5 flex max-w-6xl items-start gap-2 pb-4 text-[10px] leading-4 text-ink-ghost">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
        The free engine (yt-dlp + whisper + ffmpeg) runs on your desktop — no per-clip cost. With auto-gen on, clips are
        generated + staged for you automatically from queued sources (free engine only, never the paid lane). Auto-post stays
        dormant until a posting rail is connected. Only measured payouts you record hit the ledger, so the Money Hub stays
        cash-truth. Distribution (warmed posting accounts) is the real constraint, not editing.
      </p>
    </div>
  );
}

function Stat({ label, value, sub, tone, big }: { label: string; value: string; sub?: string; tone?: "good" | "flat"; big?: boolean }) {
  return (
    <div className="rounded-xl border border-[#ff6a3d]/15 bg-gradient-to-br from-[#ff6a3d]/[0.07] to-transparent p-3">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-[#ff6a3d]/70">{label}</p>
      <p className={cn("mt-1 font-mono font-bold leading-none", big ? "text-3xl" : "text-xl", tone === "good" ? "text-emerald-300" : "text-ink")}>{value}</p>
      {sub ? <p className="mt-1 text-[10px] text-ink-ghost">{sub}</p> : null}
    </div>
  );
}

function SetupCard({ deps }: { deps: ClippingSnapshot["deps"] }) {
  const missing = deps.deps.filter((d) => !d.ok);
  return (
    <div className="mx-auto mt-4 max-w-6xl rounded-xl border border-amber-400/30 bg-amber-400/[0.06] p-3">
      <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wide text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" /> Engine setup — {missing.length} dependenc{missing.length === 1 ? "y" : "ies"} missing
      </p>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {deps.deps.map((d) => (
          <div key={d.id} className="flex items-start gap-2 text-[11px]">
            <span className={cn("mt-0.5 h-2 w-2 flex-none rounded-full", d.ok ? "bg-emerald-400" : "bg-rose-400")} />
            <span className="text-ink-faint">
              {d.label}
              {d.ok ? <span className="ml-1 text-ink-ghost">{d.version}</span> : d.hint ? <span className="ml-1 block font-mono text-[10px] text-amber-300/80">{d.hint}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SourcePanel({
  snap, busy, onGenerate, onAct, engineReady,
}: {
  snap: ClippingSnapshot | null;
  busy: string | null;
  onGenerate: (p: Record<string, unknown>) => void;
  onAct: (a: string, p?: Record<string, unknown>) => void;
  engineReady: boolean;
}) {
  const [url, setUrl] = React.useState("");
  const [clips, setClips] = React.useState(4);
  const [aspect, setAspect] = React.useState("9:16");
  const [campaignId, setCampaignId] = React.useState("");
  const campaigns = snap?.campaigns ?? [];
  const sources = snap?.sources ?? [];

  const submit = () => {
    const u = url.trim();
    if (!u) return;
    onGenerate({ url: u, clipsNum: clips, aspect, campaignId: campaignId || undefined });
    setUrl("");
  };

  return (
    <Panel title="Source queue" icon={<Play className="h-3.5 w-3.5" />} hint="paste a YouTube / Twitch VOD, generate vertical clips">
      <div className="flex flex-col gap-2">
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://youtube.com/watch?v=…"
          className="w-full rounded border border-line/20 bg-black/40 px-2.5 py-1.5 font-mono text-[12px] text-ink placeholder:text-ink-ghost/60 focus:border-[#ff6a3d]/50 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 text-ink-ghost">
            clips
            <input type="number" min={1} max={12} value={clips} onChange={(e) => setClips(Math.max(1, Math.min(12, Number(e.target.value) || 1)))} className="w-12 rounded border border-line/20 bg-black/40 px-1.5 py-1 text-center font-mono text-ink focus:outline-none" />
          </label>
          <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-ink focus:outline-none">
            <option value="9:16">9:16</option>
            <option value="1:1">1:1</option>
            <option value="16:9">16:9</option>
          </select>
          {campaigns.length ? (
            <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} className="max-w-[150px] rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-ink focus:outline-none">
              <option value="">no campaign</option>
              {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={busy === "generate" || !url.trim() || !engineReady}
            className="ml-auto flex items-center gap-1 rounded border border-emerald-400/40 bg-emerald-400/10 px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-emerald-300 transition hover:bg-emerald-400/20 disabled:opacity-40"
            title={engineReady ? "Generate clips (free, local)" : "Install the engine dependencies first"}
          >
            {busy === "generate" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Generate
          </button>
        </div>
      </div>

      {sources.length ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {sources.slice(0, 8).map((src) => (
            <div key={src.id} className="flex items-center gap-2 rounded border border-line/[0.1] bg-white/[0.01] px-2 py-1.5 text-[11px]">
              <span className={cn("h-1.5 w-1.5 flex-none rounded-full", src.status === "clipping" ? "animate-pulse bg-amber-400" : src.status === "done" ? "bg-emerald-400" : src.status === "failed" ? "bg-rose-400" : "bg-ink-ghost/50")} />
              <span className="truncate text-ink-faint" title={src.url}>{src.title || src.url}</span>
              <span className="ml-auto flex-none font-mono text-[10px] text-ink-ghost">{src.progress || src.error || src.status}</span>
              <button type="button" onClick={() => onAct("remove-source", { id: src.id })} className="flex-none text-ink-ghost hover:text-rose-300"><X className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}

function ReviewQueue({ clips, onAct, busy }: { clips: Clip[]; onAct: (a: string, p?: Record<string, unknown>) => void; busy: string | null }) {
  return (
    <Panel title={`Review queue · ${clips.length}`} icon={<Check className="h-3.5 w-3.5" />} hint="approve the winners, then post and record the payout">
      {clips.length === 0 ? (
        <p className="text-[11px] text-ink-ghost">No clips awaiting review. Generate from a source above — finished clips land here.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {clips.map((c) => <ReviewCard key={c.id} clip={c} onAct={onAct} busy={busy} />)}
        </div>
      )}
    </Panel>
  );
}

function ReviewCard({ clip, onAct, busy }: { clip: Clip; onAct: (a: string, p?: Record<string, unknown>) => void; busy: string | null }) {
  const [posting, setPosting] = React.useState(false);
  const failed = clip.status === "failed";
  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-line/[0.14] bg-black/30">
      {failed ? (
        <div className="flex aspect-[9/16] max-h-[320px] items-center justify-center bg-rose-500/5 text-[11px] text-rose-300">
          render failed
        </div>
      ) : clip.file ? (
        <video src={`/api/clipping/media/${clip.id}`} controls preload="metadata" className="max-h-[340px] w-full bg-black" />
      ) : null}
      <div className="flex flex-1 flex-col gap-1.5 p-2.5">
        <div className="flex items-start gap-2">
          <span className={cn("mt-0.5 flex-none rounded px-1.5 py-0.5 font-mono text-[10px] font-bold", clip.viralityScore >= 70 ? "bg-emerald-400/15 text-emerald-300" : clip.viralityScore >= 45 ? "bg-amber-400/15 text-amber-300" : "bg-line/10 text-ink-ghost")}>{clip.viralityScore}</span>
          <p className="text-[12px] font-medium leading-tight text-ink">{clip.title}</p>
        </div>
        {clip.hook ? <p className="text-[11px] italic leading-snug text-[#ff8a5c]/80">“{clip.hook}”</p> : null}
        <p className="font-mono text-[9px] text-ink-ghost">{fmtDur(clip.startSec)}–{fmtDur(clip.endSec)} · {clip.durationSec}s · {clip.aspect}{clip.campaignId ? " · campaign" : ""}</p>
        {clip.hashtags?.length ? <p className="truncate text-[9px] text-ink-ghost">{clip.hashtags.join(" ")}</p> : null}

        {!failed && posting ? (
          <PostForm clip={clip} onCancel={() => setPosting(false)} onAct={onAct} busy={busy} />
        ) : (
          <div className="mt-1 flex items-center gap-1.5">
            {clip.status === "review" ? (
              <button type="button" onClick={() => onAct("approve-clip", { id: clip.id })} disabled={busy !== null} className="flex items-center gap-1 rounded border border-emerald-400/40 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-400/10"><Check className="h-3 w-3" /> approve</button>
            ) : (
              <span className="rounded border border-emerald-400/30 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300/80">approved</span>
            )}
            {!failed ? (
              <button type="button" onClick={() => setPosting(true)} disabled={busy !== null} className="flex items-center gap-1 rounded border border-[#ff6a3d]/30 px-2 py-1 font-mono text-[10px] uppercase text-[#ff8a5c] hover:bg-[#ff6a3d]/10"><Send className="h-3 w-3" /> posted</button>
            ) : null}
            <button type="button" onClick={() => onAct("reject-clip", { id: clip.id })} disabled={busy !== null} className="ml-auto flex items-center gap-1 rounded border border-line/20 px-2 py-1 font-mono text-[10px] uppercase text-ink-ghost hover:text-rose-300"><X className="h-3 w-3" /> reject</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PostForm({ clip, onCancel, onAct, busy }: { clip: Clip; onCancel: () => void; onAct: (a: string, p?: Record<string, unknown>) => void; busy: string | null }) {
  const [platform, setPlatform] = React.useState<ClipPlatform>(clip.platforms[0] ?? "tiktok");
  const [url, setUrl] = React.useState("");
  const [views, setViews] = React.useState("");
  const [earned, setEarned] = React.useState("");
  return (
    <div className="mt-1 flex flex-col gap-1.5 rounded border border-line/15 bg-black/40 p-2">
      <div className="flex items-center gap-1.5">
        <select value={platform} onChange={(e) => setPlatform(e.target.value as ClipPlatform)} className="rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink focus:outline-none">
          {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
        </select>
        <input value={views} onChange={(e) => setViews(e.target.value)} placeholder="views" inputMode="numeric" className="w-16 rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
        <div className="flex items-center rounded border border-line/20 bg-black/40 px-1"><DollarSign className="h-3 w-3 text-ink-ghost" /><input value={earned} onChange={(e) => setEarned(e.target.value)} placeholder="0.00" inputMode="decimal" className="w-14 bg-transparent px-1 py-1 font-mono text-[11px] text-emerald-300 placeholder:text-ink-ghost/60 focus:outline-none" /></div>
      </div>
      <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="post url (optional)" className="w-full rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[10px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => onAct("mark-posted", { id: clip.id, platform, url: url || undefined, views: views ? Number(views) : undefined, earnedUsd: earned ? Number(earned) : undefined })}
          className="flex items-center gap-1 rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 hover:bg-emerald-400/20"
        >
          <Check className="h-3 w-3" /> record
        </button>
        <button type="button" onClick={onCancel} className="rounded border border-line/20 px-2 py-1 font-mono text-[10px] uppercase text-ink-ghost">cancel</button>
      </div>
    </div>
  );
}

function GamePromoPanel({ promos, onAct, busy }: { promos: GamePromo[]; onAct: (a: string, p?: Record<string, unknown>) => void; busy: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [game, setGame] = React.useState("");
  const [account, setAccount] = React.useState("");
  const [gameUrl, setGameUrl] = React.useState("");
  const add = () => {
    const g = game.trim();
    if (!g) return;
    onAct("add-promo", { game: g, robloxAccount: account.trim() || undefined, gameUrl: gameUrl.trim() || undefined });
    setGame(""); setAccount(""); setGameUrl(""); setOpen(false);
  };
  return (
    <Panel title={`Game promos · ${promos.length}`} icon={<Gamepad2 className="h-3.5 w-3.5" />} hint="your own Roblox games — dev-progress clips now, launch ads later">
      {promos.length === 0 ? (
        <p className="text-[11px] text-ink-ghost">No games yet. Add your own Roblox game (e.g. Punch Simulator) to clip its progress and hype the build — then flip it to launch ads when it fully releases. Posts on @builtbybert (TikTok/Instagram/X).</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {promos.map((p) => {
            const launch = p.phase === "launch";
            return (
              <div key={p.id} className="rounded border border-line/[0.1] bg-white/[0.01] px-2 py-1.5">
                <div className="flex items-center gap-2 text-[11px]">
                  <span className={cn("h-1.5 w-1.5 flex-none rounded-full", p.active ? "bg-emerald-400" : "bg-ink-ghost/40")} />
                  <span className="truncate font-medium text-ink">{p.game}</span>
                  <button
                    type="button"
                    onClick={() => onAct("update-promo", { id: p.id, patch: { phase: launch ? "progress" : "launch" } })}
                    disabled={busy !== null}
                    title={launch ? "Launch ads — click to move back to dev-progress" : "Dev progress — click to graduate to launch ads"}
                    className={cn(
                      "ml-auto flex flex-none items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide transition",
                      launch ? "border-amber-400/40 bg-amber-400/10 text-amber-300" : "border-[#ff6a3d]/30 text-[#ff8a5c] hover:bg-[#ff6a3d]/10",
                    )}
                  >
                    {launch ? <Rocket className="h-2.5 w-2.5" /> : <Gamepad2 className="h-2.5 w-2.5" />} {launch ? "launch ads" : "progress"}
                  </button>
                  <button type="button" onClick={() => onAct("remove-promo", { id: p.id })} className="flex-none text-ink-ghost hover:text-rose-300"><X className="h-3 w-3" /></button>
                </div>
                <p className="mt-0.5 truncate text-[9px] text-ink-ghost">
                  {[
                    p.postProfile ? `via @${p.postProfile.replace(/^@/, "")}` : null,
                    p.targetPlatforms.map((t) => PLATFORM_LABEL[t]).join("/"),
                    p.robloxAccount ? `source @${p.robloxAccount.replace(/^@/, "")}` : null,
                  ].filter(Boolean).join(" · ")}
                </p>
              </div>
            );
          })}
        </div>
      )}
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5 rounded border border-line/15 bg-black/40 p-2">
          <input value={game} onChange={(e) => setGame(e.target.value)} placeholder="game name (e.g. Punch Simulator)" className="rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
          <input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="roblox account (optional — connect later)" className="rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
          <input value={gameUrl} onChange={(e) => setGameUrl(e.target.value)} placeholder="game link (optional)" className="rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
          <div className="flex gap-1.5">
            <button type="button" disabled={busy !== null || !game.trim()} onClick={add} className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300 disabled:opacity-40">add</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-line/20 px-2 py-1 font-mono text-[10px] uppercase text-ink-ghost">cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase text-[#ff6a3d]/80 hover:text-[#ff6a3d]"><Plus className="h-3 w-3" /> add game</button>
      )}
    </Panel>
  );
}

function CampaignPanel({ campaigns, onAct, busy }: { campaigns: ClippingCampaign[]; onAct: (a: string, p?: Record<string, unknown>) => void; busy: string | null }) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [pay, setPay] = React.useState("");
  const [creator, setCreator] = React.useState("");
  const add = () => {
    const p = Number(pay);
    if (!name.trim() || !Number.isFinite(p)) return;
    onAct("add-campaign", { name: name.trim(), payPerThousandUsd: p, creator: creator.trim() || undefined });
    setName(""); setPay(""); setCreator(""); setOpen(false);
  };
  return (
    <Panel title={`Paid campaigns · ${campaigns.length}`} icon={<DollarSign className="h-3.5 w-3.5" />} hint="who pays per 1k views (Whop-style bounties)">
      {campaigns.length === 0 ? (
        <p className="text-[11px] text-ink-ghost">No campaigns yet. The money is in bounties that pay per 1k verified views — add one to target it.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {campaigns.map((c) => (
            <div key={c.id} className="rounded border border-line/[0.1] bg-white/[0.01] px-2 py-1.5">
              <div className="flex items-center gap-2 text-[11px]">
                <span className={cn("h-1.5 w-1.5 flex-none rounded-full", c.active ? "bg-emerald-400" : "bg-ink-ghost/40")} />
                <span className="truncate font-medium text-ink">{c.name}</span>
                <span className="ml-auto flex-none font-mono text-emerald-300">{usd(c.payPerThousandUsd)}/1k</span>
                <button type="button" onClick={() => onAct("remove-campaign", { id: c.id })} className="flex-none text-ink-ghost hover:text-rose-300"><X className="h-3 w-3" /></button>
              </div>
              <p className="mt-0.5 truncate text-[9px] text-ink-ghost">{[c.creator, c.targetPlatforms.map((p) => PLATFORM_LABEL[p]).join("/")].filter(Boolean).join(" · ")}</p>
            </div>
          ))}
        </div>
      )}
      {open ? (
        <div className="mt-2 flex flex-col gap-1.5 rounded border border-line/15 bg-black/40 p-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="campaign name" className="rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
          <div className="flex gap-1.5">
            <input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="creator" className="flex-1 rounded border border-line/20 bg-black/40 px-1.5 py-1 font-mono text-[11px] text-ink placeholder:text-ink-ghost/60 focus:outline-none" />
            <div className="flex items-center rounded border border-line/20 bg-black/40 px-1"><DollarSign className="h-3 w-3 text-ink-ghost" /><input value={pay} onChange={(e) => setPay(e.target.value)} placeholder="CPM" inputMode="decimal" className="w-16 bg-transparent px-1 py-1 font-mono text-[11px] text-emerald-300 placeholder:text-ink-ghost/60 focus:outline-none" /></div>
          </div>
          <div className="flex gap-1.5">
            <button type="button" disabled={busy !== null} onClick={add} className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 font-mono text-[10px] uppercase text-emerald-300">add</button>
            <button type="button" onClick={() => setOpen(false)} className="rounded border border-line/20 px-2 py-1 font-mono text-[10px] uppercase text-ink-ghost">cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1 font-mono text-[10px] uppercase text-[#ff6a3d]/80 hover:text-[#ff6a3d]"><Plus className="h-3 w-3" /> add campaign</button>
      )}
    </Panel>
  );
}

function ProducerPanel({ snap, busy, onAct, armed }: { snap: ClippingSnapshot | null; busy: string | null; onAct: (a: string, p?: Record<string, unknown>) => void; armed: boolean }) {
  const cfg = snap?.config;
  const running = Boolean(snap?.producerRunning);
  const autoGen = Boolean(cfg?.autoGenerate && armed);
  const threshold = cfg?.autoApproveMinScore ?? 0;
  const autoPostOn = Boolean(cfg?.autoPost && armed);
  const wired = Boolean(snap?.postingWired);
  return (
    <Panel title="Auto-producer" icon={<Scissors className="h-3.5 w-3.5" />} hint="free engine generates + stages clips hands-off">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== null || running || cfg?.killSwitch} onClick={() => onAct("produce-now")} className="flex items-center gap-1 rounded border border-[#ff6a3d]/30 px-2 py-1 font-mono text-[10px] uppercase text-[#ff8a5c] hover:bg-[#ff6a3d]/10 disabled:opacity-40">
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Scissors className="h-3 w-3" />} generate next
        </button>
        <button type="button" onClick={() => onAct("set-config", { config: { autoGenerate: !cfg?.autoGenerate } })} className={cn("rounded border px-2 py-1 font-mono text-[10px] uppercase transition", autoGen ? "border-emerald-400/40 text-emerald-300" : "border-line/20 text-ink-ghost")}>
          auto-gen {cfg?.autoGenerate ? "on" : "off"}
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] uppercase text-ink-ghost">auto-approve</span>
        {[0, 70, 85].map((v) => (
          <button key={v} type="button" onClick={() => onAct("set-config", { config: { autoApproveMinScore: v } })} className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] transition", threshold === v ? "border-emerald-400/40 text-emerald-300" : "border-line/20 text-ink-ghost")}>
            {v === 0 ? "off" : `>=${v}`}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] leading-4 text-ink-faint">
        {snap?.lastProduceNote || "Idle. Arm auto-gen and queue a source (or set a campaign's source channel URL) — clips generate on their own."}
      </p>
      <p className="mt-1.5 flex items-center gap-1.5 text-[9px] text-ink-ghost">
        <span className={cn("h-1.5 w-1.5 rounded-full", autoPostOn && wired ? "bg-emerald-400" : autoPostOn ? "bg-amber-400" : "bg-line/30")} />
        {autoPostOn && wired ? "auto-post live — approved clips upload automatically" : autoPostOn ? "auto-post armed — dormant until a posting rail (creds) is connected" : "auto-post off — staged clips wait for a one-tap post"}
      </p>
    </Panel>
  );
}

function ResearchPanel({ snap, busy, onAct, armed }: { snap: ClippingSnapshot | null; busy: string | null; onAct: (a: string, p?: Record<string, unknown>) => void; armed: boolean }) {
  const rec = snap?.lastRecommendation;
  return (
    <Panel title="Research" icon={<Radar className="h-3.5 w-3.5" />} hint="free council: which sources + campaigns to chase">
      <div className="flex items-center gap-2">
        <button type="button" disabled={busy !== null || snap?.researchRunning} onClick={() => onAct("research-now")} className="flex items-center gap-1 rounded border border-[#ff6a3d]/30 px-2 py-1 font-mono text-[10px] uppercase text-[#ff8a5c] hover:bg-[#ff6a3d]/10 disabled:opacity-40">
          {snap?.researchRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Radar className="h-3 w-3" />} research now
        </button>
        <button type="button" onClick={() => onAct("set-config", { config: { autoResearch: !snap?.config.autoResearch } })} className={cn("rounded border px-2 py-1 font-mono text-[10px] uppercase transition", snap?.config.autoResearch && armed ? "border-emerald-400/40 text-emerald-300" : "border-line/20 text-ink-ghost")}>
          auto {snap?.config.autoResearch ? "on" : "off"}
        </button>
      </div>
      {rec ? <p className="mt-2 whitespace-pre-wrap text-[10px] leading-4 text-ink-faint">{rec}</p> : <p className="mt-2 text-[10px] text-ink-ghost">No research yet. Runs free (GLM council) and logs learnings to the vault — never renders or posts.</p>}
    </Panel>
  );
}

function LedgerPanel({ snap }: { snap: ClippingSnapshot | null }) {
  const earnings = snap?.earnings ?? [];
  return (
    <Panel title="Earnings ledger" icon={<DollarSign className="h-3.5 w-3.5" />} hint="measured payouts only — the money source of truth">
      {earnings.length === 0 ? (
        <p className="text-[11px] text-ink-ghost">No payouts recorded yet. When a clip earns, record it here (or via a clip’s “posted” button) and it flows to the Money Hub.</p>
      ) : (
        <div className="flex flex-col gap-1">
          {earnings.slice(0, 10).map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono text-[9px] text-ink-ghost">{e.dateISO.slice(5)}</span>
              <span className="truncate text-ink-faint">{e.note || e.source}</span>
              <span className="ml-auto flex-none font-mono text-emerald-300">{usd(e.amountUsd, true)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function Panel({ title, icon, hint, children }: { title: string; icon: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line/[0.12] bg-white/[0.02] p-3">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wide text-[#ff6a3d]">{icon} {title}</span>
        {hint ? <span className="truncate text-[9px] text-ink-ghost">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}
