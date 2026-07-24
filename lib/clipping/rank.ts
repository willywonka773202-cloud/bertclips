import "server-only";

import { onlineProviderIds } from "@/lib/providers";
import { getRegistryEntry } from "@/lib/providers/registry";
import { askProvider } from "@/lib/providers/router";
import type { ProviderId } from "@/types/provider";
import type { ClippingCampaign } from "@/types/clipping";

/**
 * lib/clipping/rank.ts — pick the most viral moments out of a transcript.
 *
 * FREE-FIRST: ranking asks only FREE/LOCAL brains (GLM via Ollama + free voices),
 * never a paid API — exactly like the other autonomous loops. If no free brain is
 * online, or the model returns unparseable output, it falls back to a deterministic
 * heuristic so a render NEVER hard-fails just because the brain was unavailable.
 */

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface Highlight {
  start: number;
  end: number;
  title: string;
  hook: string;
  reasons: string[];
  score: number;
  hashtags: string[];
}

const MIN_CLIP = 15;
const MAX_CLIP = 90;
const MAX_PROMPT_CHARS = 12_000;

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

async function pickFreeProvider(): Promise<ProviderId | null> {
  const online = await onlineProviderIds().catch(() => [] as ProviderId[]);
  const free = online.filter((id) => {
    const b = getRegistryEntry(id)?.billing;
    return b === "free" || b === "local";
  });
  if (!free.length) return null;
  const ollama = free.find((id) => String(id) === "ollama");
  return ollama ?? free[0] ?? null;
}

function clampWindow(start: number, end: number, duration: number): { start: number; end: number } | null {
  const s = Math.max(0, Number(start));
  let e = Math.min(duration, Number(end));
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null;
  const len = e - s;
  if (len < MIN_CLIP) e = Math.min(duration, s + MIN_CLIP);
  if (e - s > MAX_CLIP) e = s + MAX_CLIP;
  if (e <= s) return null;
  return { start: Math.round(s * 100) / 100, end: Math.round(e * 100) / 100 };
}

function extractJsonArray(text: string): unknown[] | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function campaignContext(campaign: ClippingCampaign | null): string {
  if (!campaign) return "There is no specific paid campaign; optimize for broad viral reach on TikTok/Reels/Shorts.";
  const platforms = campaign.targetPlatforms.join(", ");
  return [
    `This is for the paid clipping campaign "${campaign.name}"${campaign.creator ? ` (creator: ${campaign.creator})` : ""}.`,
    `It pays $${campaign.payPerThousandUsd.toFixed(2)} per 1,000 verified views on: ${platforms}.`,
    campaign.requirements ? `Requirements: ${campaign.requirements}` : "",
    "Pick moments most likely to rack up views on those platforms.",
  ]
    .filter(Boolean)
    .join(" ");
}

const RANK_INSTRUCTIONS = [
  "You are an elite short-form video editor who finds the moments that go viral on TikTok, Reels, and Shorts.",
  "Score each candidate moment 0-100 on this framework: a strong HOOK in the first 2 seconds, an emotional peak, an opinion bomb / hot take, a surprising revelation, conflict or tension, a highly quotable line, a story payoff, or concrete practical value.",
  "Each clip must be a self-contained 15-60 second window that makes sense without the rest of the video.",
  "Return ONLY a JSON array (no prose). Each element:",
  '{ "start": <seconds>, "end": <seconds>, "title": "<=8 word internal title", "hook": "the scroll-stopping on-screen caption", "reasons": ["why it hits"], "score": 0-100, "hashtags": ["#tag"] }',
].join("\n");

/**
 * Rank the transcript into the top `count` clip windows. Never throws — returns a
 * heuristic set if the free brain is unavailable or returns garbage.
 */
export async function rankHighlights(input: {
  segments: TranscriptSegment[];
  duration: number;
  count: number;
  campaign?: ClippingCampaign | null;
}): Promise<{ highlights: Highlight[]; usedBrain: boolean; provider?: string }> {
  const { segments, duration } = input;
  const count = Math.max(1, Math.min(20, input.count));
  const campaign = input.campaign ?? null;

  const provider = await pickFreeProvider();
  if (provider && segments.length) {
    let lines = "";
    for (const seg of segments) {
      const next = `[${mmss(seg.start)}] ${seg.text}\n`;
      if (lines.length + next.length > MAX_PROMPT_CHARS) break;
      lines += next;
    }
    const prompt = [
      RANK_INSTRUCTIONS,
      "",
      campaignContext(campaign),
      "",
      `Source is ${Math.round(duration)} seconds long. Choose the ${count} best clips, highest score first.`,
      "",
      "TRANSCRIPT (timestamps are minutes:seconds from the start):",
      lines,
    ].join("\n");

    const res = await askProvider(provider, { prompt }).catch(() => null);
    if (res?.ok) {
      const arr = extractJsonArray(res.data.text ?? "");
      if (arr) {
        const highlights: Highlight[] = [];
        for (const raw of arr) {
          if (!raw || typeof raw !== "object") continue;
          const o = raw as Record<string, unknown>;
          const win = clampWindow(Number(o.start), Number(o.end), duration);
          if (!win) continue;
          highlights.push({
            start: win.start,
            end: win.end,
            title: typeof o.title === "string" && o.title.trim() ? o.title.trim().slice(0, 80) : "Clip",
            hook: typeof o.hook === "string" && o.hook.trim() ? o.hook.trim().slice(0, 120) : "",
            reasons: Array.isArray(o.reasons) ? o.reasons.filter((r): r is string => typeof r === "string").slice(0, 5) : [],
            score: Math.max(0, Math.min(100, Math.round(Number(o.score) || 50))),
            hashtags: Array.isArray(o.hashtags)
              ? o.hashtags.filter((h): h is string => typeof h === "string").map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 8)
              : [],
          });
          if (highlights.length >= count) break;
        }
        if (highlights.length) {
          highlights.sort((a, b) => b.score - a.score);
          return { highlights, usedBrain: true, provider: String(provider) };
        }
      }
    }
  }

  return { highlights: heuristicHighlights(segments, duration, count), usedBrain: false };
}

/** Deterministic fallback: evenly-spaced ~40s windows snapped to segment boundaries. */
function heuristicHighlights(segments: TranscriptSegment[], duration: number, count: number): Highlight[] {
  const target = 40;
  const usable = Math.max(duration, target);
  const step = usable / count;
  const out: Highlight[] = [];
  for (let i = 0; i < count; i++) {
    const center = step * (i + 0.5);
    const start = Math.max(0, center - target / 2);
    const win = clampWindow(start, start + target, duration);
    if (!win) continue;
    const text = segments
      .filter((s) => s.start >= win.start - 1 && s.start <= win.end)
      .map((s) => s.text)
      .join(" ")
      .trim();
    const title = text.split(/\s+/).slice(0, 6).join(" ") || `Clip ${i + 1}`;
    out.push({
      start: win.start,
      end: win.end,
      title: title.slice(0, 80),
      hook: title.slice(0, 120),
      reasons: ["Evenly-sampled fallback (no free brain online to rank)."],
      score: 45,
      hashtags: ["#clip", "#viral", "#fyp"],
    });
  }
  return out;
}
