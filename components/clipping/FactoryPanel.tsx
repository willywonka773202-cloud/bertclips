"use client";

import * as React from "react";
import {
  Activity,
  Clapperboard,
  Loader2,
  Power,
  RefreshCw,
  Send,
  TriangleAlert,
  Upload,
  Zap,
} from "lucide-react";

import { apiGet, apiPost, errorMessage } from "@/lib/client/api";
import { cn } from "@/lib/cn";
import { platformRows, normPlatform } from "@/lib/clipping/platform-rows";
import type { FactoryStatus, FactoryTask } from "@/types/clipping";

/** The platform tabs shown above the accounts (null = All). */
const PLATFORM_FILTERS: { key: string; label: string }[] = [
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
  { key: "instagram", label: "Instagram" },
];

/** Brand-ish dot per platform so the separated accounts read at a glance. */
const PLATFORM_DOT: Record<string, string> = {
  tiktok: "#25F4EE",
  instagram: "#E1306C",
  youtube: "#FF0000",
  x: "#e7e9ea",
  twitter: "#e7e9ea",
};

/**
 * FactoryPanel — the in-app face of the LIVE local posting factory (BertClipsHub).
 *
 * It polls GET /api/clipping/factory for the read-only operational state (accounts,
 * buffers, today's per-platform schedule, payout queue, alerts, live activity) and
 * drives the gated POST controls (fill / generate / post / collect, arm/disarm). The
 * factory runs on the desktop host, so on the public cloud edge this renders a clear
 * "offline" card rather than pretending — honest by construction.
 */

const TASKS: { id: FactoryTask; label: string; icon: React.ElementType; blurb: string }[] = [
  { id: "viral", label: "Fill viral clips", icon: Clapperboard, blurb: "Pull fresh proven-viral Twitch clips into the buffers" },
  { id: "generate", label: "Generate", icon: Zap, blurb: "Cut new clips from VOD sections to top up buffers" },
  { id: "post", label: "Post due", icon: Upload, blurb: "Run one posting cycle now (respects safe per-platform caps)" },
  { id: "collect", label: "Refresh URLs", icon: Send, blurb: "Map posted clips to their live URLs for the payout queue" },
];

function fmtNum(v: number | undefined | null): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return v.toLocaleString();
}

function ago(iso?: string | null): string {
  if (!iso) return "never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "never";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function until(ms?: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const s = Math.round((ms - Date.now()) / 1000);
  if (s <= 0) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}

export function FactoryPanel() {
  const [f, setF] = React.useState<FactoryStatus | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [loaded, setLoaded] = React.useState(false);
  const [platFilter, setPlatFilter] = React.useState<string | null>(null);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await apiGet<FactoryStatus>("/api/clipping/factory", signal);
      setF(data);
      setErr(null);
      setLoaded(true);
    } catch (e) {
      // A cancelled in-flight poll (component unmounted) must not setState.
      if (e instanceof DOMException && e.name === "AbortError") return;
      setErr(errorMessage(e));
      setLoaded(true);
    }
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    const t = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, 10_000);
    return () => {
      controller.abort();
      window.clearInterval(t);
    };
  }, [load]);

  const act = React.useCallback(async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setErr(null);
    try {
      setF(await apiPost<FactoryStatus>("/api/clipping/factory", body));
    } catch (e) {
      setErr(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const online = f?.online === true;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line/[0.16] bg-white/[0.02] p-3 sm:p-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line/[0.10] pb-2.5">
        <span className="flex items-center gap-2 text-sm font-medium text-ink">
          <Activity className="h-4 w-4 text-accent" /> Live Factory
        </span>
        <span
          className={cn(
            "label-mono rounded-control px-1.5 py-0.5",
            online ? "bg-[rgb(var(--ok)/0.12)] text-ok" : "bg-white/[0.04] text-ink-ghost",
          )}
        >
          {!loaded ? "…" : online ? "ONLINE" : "OFFLINE"}
        </span>
        {online ? (
          <button
            type="button"
            onClick={() => void act({ action: f?.armed ? "disarm" : "arm" }, "arm")}
            disabled={busy !== null}
            title={f?.armed ? "Autopost is armed — click to disarm" : "Autopost is disarmed — click to arm"}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-control border px-2 py-1 text-[11px] font-medium transition-colors disabled:opacity-60",
              f?.armed
                ? "border-[rgb(var(--ok)/0.4)] bg-[rgb(var(--ok)/0.10)] text-ok"
                : "border-line/[0.16] text-ink-faint hover:bg-white/[0.06] hover:text-ink",
            )}
          >
            {busy === "arm" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
            {f?.armed ? "Armed" : "Disarmed"}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void load()}
          title="Re-read the live factory status"
          className="ml-auto inline-flex items-center gap-1.5 rounded-control border border-line/[0.14] px-2 py-1 text-[11px] text-ink-faint transition-colors hover:bg-white/[0.05] hover:text-ink"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {err ? (
        <p className="flex items-start gap-2 rounded-control border border-[rgb(var(--warn)/0.3)] bg-[rgb(var(--warn)/0.06)] px-2.5 py-1.5 text-[11px] text-[rgb(var(--warn))]">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 flex-none" /> {err}
        </p>
      ) : null}

      {!loaded ? (
        <div className="flex items-center gap-2 py-6 text-[12px] text-ink-ghost">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading the live factory…
        </div>
      ) : !online ? (
        <div className="rounded-control border border-line/[0.12] bg-white/[0.01] px-3 py-5 text-center">
          <p className="text-[12px] text-ink-muted">{f?.reason || "The local clip factory is not reachable."}</p>
          <p className="mt-1 text-[10px] text-ink-ghost">
            The posting factory runs on the desktop host (BertClipsHub on :4477). This panel goes live when
            you open the cockpit on that machine or over Tailscale.
          </p>
        </div>
      ) : (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line/[0.16] bg-line/[0.16] sm:grid-cols-4">
            <Tote label="ACCOUNTS" value={fmtNum(f?.totals.accounts)} />
            <Tote label="POSTS" value={fmtNum(f?.totals.posts)} />
            <Tote label="IMPRESSIONS" value={fmtNum(f?.totals.impressions)} />
            <Tote label="FOLLOWERS" value={fmtNum(f?.totals.followers)} />
          </div>

          {/* Controls */}
          <div className="flex flex-wrap items-center gap-1.5">
            {TASKS.map((t) => {
              const running = f?.runs[t.id]?.running === true;
              const disabled = busy !== null || running;
              const Icon = t.icon;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => void act({ action: "run", task: t.id }, t.id)}
                  disabled={disabled}
                  title={t.blurb}
                  className="inline-flex items-center gap-1.5 rounded-control border border-line/[0.16] px-2.5 py-1 text-[11px] font-medium text-ink-faint transition-colors hover:bg-white/[0.06] hover:text-ink disabled:opacity-60"
                >
                  {busy === t.id || running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />}
                  {running ? `${t.label}…` : t.label}
                </button>
              );
            })}
          </div>

          {/* Accounts — filterable by platform so you can see TikTok / YouTube / X / Instagram separately. */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="label-mono mr-1 text-ink-ghost">ACCOUNTS</span>
            <FilterChip label="All" active={platFilter === null} onClick={() => setPlatFilter(null)} />
            {PLATFORM_FILTERS.map((p) => (
              <FilterChip
                key={p.key}
                label={p.label}
                dot={PLATFORM_DOT[p.key]}
                active={platFilter === p.key}
                onClick={() => setPlatFilter(platFilter === p.key ? null : p.key)}
              />
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(f?.accounts || [])
              .filter((a) => !platFilter || a.platforms.some((p) => normPlatform(p) === platFilter))
              .map((a) => {
              const bufferLow = a.unposted <= 2;
              const rows = platformRows(a, f?.schedule || []).filter(
                (r) => !platFilter || normPlatform(r.platform) === platFilter,
              );
              return (
                <div key={a.profile} className="rounded-control border border-line/[0.12] bg-[rgb(var(--panel)/0.55)] px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-ink" title={a.profile}>
                      @{a.profile}
                    </span>
                    <span className="label-mono text-ink-ghost">{a.postsToday}/{a.dailyCap} today</span>
                  </div>

                  {/* Separated per-platform accounts: real @handle + today's cadence per platform. */}
                  <div className="mt-1.5 space-y-1">
                    {rows.length ? (
                      rows.map((r) => (
                        <div key={r.platform} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span
                              className="inline-block h-1.5 w-1.5 flex-none rounded-full"
                              style={{ background: PLATFORM_DOT[r.platform.toLowerCase()] || "rgb(var(--ink-ghost))" }}
                            />
                            <span className="flex-none text-ink-faint">{r.label}</span>
                            {r.handle ? (
                              <span className="truncate font-mono text-ink-ghost" title={r.handle}>
                                {r.handle}
                              </span>
                            ) : null}
                          </span>
                          <span className="flex-none font-mono text-ink-ghost">
                            {r.needsReauth ? (
                              <span className="flex items-center gap-1 text-[rgb(var(--warn))]">
                                <TriangleAlert className="h-3 w-3 flex-none" /> reconnect
                              </span>
                            ) : r.perDay != null ? (
                              <>
                                <span className="text-ink">
                                  {r.postedToday}/{r.perDay}
                                </span>
                                {r.atCap ? <span className="text-ink-ghost"> · done</span> : null}
                              </>
                            ) : (
                              "—"
                            )}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-[10px] text-ink-ghost">no platforms connected</p>
                    )}
                  </div>

                  {/* Profile-level (upload-post aggregates across the platforms above). */}
                  <div className="mt-1.5 flex items-center justify-between border-t border-line/[0.08] pt-1.5 text-[10px] text-ink-faint">
                    <span>
                      Buffer{" "}
                      <b className={cn("font-mono", bufferLow ? "text-[rgb(var(--warn))]" : "text-ink")}>
                        {a.unposted}/{a.bufferTarget}
                      </b>
                    </span>
                    <span>
                      Impr. <b className="font-mono text-ink">{fmtNum(a.impressions)}</b>
                    </span>
                    <span className="text-ink-ghost">last post {ago(a.lastPostAt)}</span>
                  </div>
                </div>
              );
            })}
            {(f?.accounts || []).filter((a) => !platFilter || a.platforms.some((p) => normPlatform(p) === platFilter)).length === 0 ? (
              <p className="col-span-full rounded-control border border-line/[0.10] bg-white/[0.01] px-3 py-4 text-center text-[11px] text-ink-ghost">
                {platFilter
                  ? `No ${PLATFORM_FILTERS.find((p) => p.key === platFilter)?.label ?? platFilter} accounts connected yet.`
                  : "No posting accounts yet — connect one on upload-post."}
              </p>
            ) : null}
          </div>

          {/* Real per-post tracking (views ledger + learned lessons, from the factory) */}
          {f?.tracking && f.tracking.tracked > 0 && (
            <div className="rounded-control border border-line/[0.12] bg-white/[0.01] px-2.5 py-2 text-[11px] text-ink-faint">
              <span className="label-mono mr-2 text-ink-ghost">REAL TRACKING</span>
              <b className="font-mono text-ink">{fmtNum(f.tracking.views)}</b> views across{" "}
              <b className="font-mono text-ink">{f.tracking.tracked}</b>/{f.tracking.posts} posts
              {f.tracking.topClip && (
                <>
                  {" "}· top <b className="font-mono text-ink">{fmtNum(f.tracking.topViews)}</b>{" "}
                  <span className="text-ink-ghost">({f.tracking.topClip.slice(0, 28)})</span>
                </>
              )}
              {f.tracking.lesson && <span className="text-ink-ghost"> · learned: {f.tracking.lesson}</span>}
            </div>
          )}

          {/* Connections: every upload-post profile, INCLUDING ones not wired to a program yet.
              Connect an account in upload-post and it appears here on the next factory cycle. */}
          {(f?.connections || []).length > 0 && (
            <div className="rounded-control border border-line/[0.12] bg-white/[0.01] px-2.5 py-2">
              <h3 className="label-mono mb-1.5 text-ink-ghost">CONNECTED ON UPLOAD-POST</h3>
              <div className="flex flex-wrap gap-1.5">
                {(f?.connections || []).map((c) => (
                  <span
                    key={c.profile}
                    title={c.routed ? `posting via ${c.platforms.join(", ") || "no platforms"}` : "connected but not wired to a program yet"}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-control border px-2 py-0.5 text-[10px]",
                      c.routed ? "border-line/[0.14] text-ink-faint" : "border-[rgb(var(--warn)/0.4)] text-[rgb(var(--warn))]",
                    )}
                  >
                    @{c.profile}
                    <span className={cn("font-mono", c.routed ? "text-ink-ghost" : "")}>
                      {c.platforms.join("·") || "none"}
                    </span>
                    {!c.routed && <TriangleAlert className="h-2.5 w-2.5 flex-none" />}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Today's schedule + payout queue */}
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            <div className="rounded-control border border-line/[0.12] bg-white/[0.01] p-2.5">
              <h3 className="label-mono mb-1.5 text-ink-ghost">TODAY&apos;S SCHEDULE</h3>
              <div className="space-y-1.5">
                {(f?.schedule || []).map((s) => (
                  <div key={s.profile} className="text-[10px]">
                    <span className="text-ink-faint">@{s.profile}</span>
                    <span className="ml-1 flex flex-wrap gap-x-2 gap-y-0.5 text-ink-ghost">
                      {s.platforms.map((p) => (
                        <span key={p.platform} title={`${p.perDay}/day, ${p.gapMin}m gap`}>
                          {p.platform} <b className="font-mono text-ink-faint">{p.postedToday.length}/{p.perDay}</b>
                          {!p.atCap ? <span className="text-ink-ghost"> · {until(p.nextAt)}</span> : <span className="text-ink-ghost"> · done</span>}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
                {!(f?.schedule || []).length ? <p className="text-[10px] text-ink-ghost">No connected platforms yet.</p> : null}
              </div>
            </div>

            <div className="rounded-control border border-line/[0.12] bg-white/[0.01] p-2.5">
              <h3 className="label-mono mb-1.5 text-ink-ghost">PAYOUT QUEUE</h3>
              <div className="mb-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ink-faint">
                <span>{f?.submissions.totalPending ?? 0} pending</span>
                {(f?.submissions.agingPending ?? 0) > 0 ? (
                  <span className="text-[rgb(var(--warn))]">{f?.submissions.agingPending} aging &gt;24h</span>
                ) : null}
                {(f?.submissions.needsProgram ?? 0) > 0 ? (
                  <span className="text-[rgb(var(--warn))]">{f?.submissions.needsProgram} unassigned</span>
                ) : null}
                <span className="text-ink-ghost">{f?.submissions.totalSubmitted ?? 0} submitted</span>
              </div>
              <div className="space-y-1">
                {(f?.submissions.programs || []).slice(0, 6).map((p) => (
                  <div key={p.campaign} className="flex items-center justify-between gap-2 text-[10px]">
                    <span className={cn("truncate", p.needsProgram ? "text-[rgb(var(--warn))]" : "text-ink-faint")} title={p.campaign}>
                      {p.campaign}
                    </span>
                    <span className="font-mono text-ink-ghost">{p.pending.length} pending</span>
                  </div>
                ))}
                {!(f?.submissions.programs || []).length ? <p className="text-[10px] text-ink-ghost">Nothing waiting to submit.</p> : null}
              </div>
            </div>
          </div>

          {/* Alerts */}
          {(f?.alerts || []).length ? (
            <div className="space-y-1">
              {(f?.alerts || []).map((al, i) => (
                <p
                  key={`${al.level}-${i}`}
                  className={cn(
                    "flex items-start gap-2 text-[10px]",
                    al.level === "warn" ? "text-[rgb(var(--warn))]" : al.level === "ok" ? "text-ok" : "text-ink-faint",
                  )}
                >
                  <span className="mt-0.5 flex-none">•</span> {al.msg}
                </p>
              ))}
            </div>
          ) : null}

          {/* Live activity */}
          <details className="rounded-control border border-line/[0.10] bg-white/[0.01]">
            <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[10px] text-ink-ghost transition-colors hover:text-ink-faint">
              Live activity (scheduler + autopilot)
            </summary>
            <div className="max-h-40 overflow-auto border-t border-line/[0.10] px-2.5 py-2">
              <pre className="whitespace-pre-wrap break-words font-mono text-[9px] leading-4 text-ink-ghost">
                {[...(f?.activity.scheduler || []).slice(-12), ...(f?.activity.autopilot || []).slice(-6)].join("\n") ||
                  "No recent log lines."}
              </pre>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

function FilterChip({
  label,
  dot,
  active,
  onClick,
}: {
  label: string;
  dot?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control border px-2 py-0.5 text-[11px] font-medium transition-colors",
        active
          ? "border-accent/50 bg-accent/[0.12] text-ink"
          : "border-line/[0.14] text-ink-faint hover:bg-white/[0.06] hover:text-ink",
      )}
    >
      {dot ? <span className="inline-block h-1.5 w-1.5 flex-none rounded-full" style={{ background: dot }} /> : null}
      {label}
    </button>
  );
}

function Tote({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-3 py-2">
      <span className="label-mono text-ink-ghost">{label}</span>
      <p className="mt-1 truncate font-mono text-[13px] text-ink" title={value}>
        {value}
      </p>
    </div>
  );
}
