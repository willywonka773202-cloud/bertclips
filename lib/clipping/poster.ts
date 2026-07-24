import "server-only";

import { promises as fs } from "node:fs";

import { appendLog } from "@/lib/core/logging";
import type { Clip, ClipPlatform } from "@/types/clipping";

/**
 * lib/clipping/poster.ts — the POSTING RAIL for the autonomous producer.
 *
 * Publishing a clip to a real account is an outward, hard-to-undo action: a bad auto-post
 * can get an account flagged or banned, which destroys the income rather than making it.
 * So the rail is CREDENTIAL-GATED, exactly like a paper->live trading venue — the
 * capability exists and the producer calls it, but it only becomes live once real creds
 * are present in the environment AND config.autoPost is armed. With no creds it reports []
 * connected platforms and every attempt returns a clear reason, leaving clips for a human.
 *
 * YouTube is the one implemented rail (a faceless Shorts channel is a legitimate clipping
 * outlet and the Data API supports uploads). It needs an OAuth client + refresh token with
 * the youtube.upload scope, supplied via env (never committed):
 *   YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN
 *   CLIPPING_YT_PRIVACY  (optional: private | unlisted | public; default private)
 * First uploads default to PRIVATE so you can eyeball them before flipping to public —
 * this upload path has not been exercised against a live account yet.
 */

export interface PostResult {
  posted: boolean;
  platform?: ClipPlatform;
  url?: string;
  /** Populated when posted:false — the honest reason (no rail, not eligible, error). */
  reason?: string;
}

function ytCreds(): { clientId: string; clientSecret: string; refreshToken: string } | null {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

/** Which platforms have a real, connected posting rail. Empty until creds are supplied. */
export function connectedPostingPlatforms(): ClipPlatform[] {
  if (ytCreds()) return ["youtube"];
  // No rail connected. Returning [] keeps auto-post dormant no matter what config.autoPost
  // says — arming it is a pre-authorization that activates the moment creds land here.
  return [];
}

/** True when at least one posting rail is connected. */
export function isPostingWired(): boolean {
  return connectedPostingPlatforms().length > 0;
}

/**
 * Attempt to publish one approved clip. Returns a structured result; NEVER throws. With no
 * rail connected this returns posted:false with a clear reason, so the caller leaves the
 * clip untouched (still "approved") for a human to post by hand.
 */
export async function postClip(clip: Clip): Promise<PostResult> {
  const connected = connectedPostingPlatforms();
  if (!connected.length) {
    return {
      posted: false,
      reason:
        "No posting account is connected. Set YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN (youtube.upload scope) to wire the YouTube rail; until then staged clips wait for a one-tap manual post.",
    };
  }
  const target = clip.platforms.find((p) => connected.includes(p)) ?? connected[0];
  if (!target) return { posted: false, reason: "No connected platform matches this clip's targets." };
  if (target === "youtube") return postToYouTube(clip);
  return { posted: false, platform: target, reason: `Posting to ${target} is not implemented yet — only the YouTube rail is wired.` };
}

/** Exchange the refresh token for a short-lived access token. */
async function youTubeAccessToken(): Promise<string | null> {
  const creds = ytCreds();
  if (!creds) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        refresh_token: creds.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) {
      await appendLog({ level: "warn", source: "clipping:poster", message: `youtube token refresh failed: ${res.status} ${(await res.text()).slice(0, 200)}` });
      return null;
    }
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch (e) {
    await appendLog({ level: "warn", source: "clipping:poster", message: `youtube token error: ${e instanceof Error ? e.message : String(e)}` });
    return null;
  }
}

function privacyStatus(): "private" | "unlisted" | "public" {
  const v = process.env.CLIPPING_YT_PRIVACY?.trim().toLowerCase();
  return v === "public" || v === "unlisted" ? v : "private";
}

/** Upload one rendered clip to YouTube via the Data API (resumable, single PUT). */
async function postToYouTube(clip: Clip): Promise<PostResult> {
  if (!clip.file) return { posted: false, platform: "youtube", reason: "Clip has no rendered file to upload." };
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(clip.file);
  } catch {
    return { posted: false, platform: "youtube", reason: "Rendered clip file is missing on disk." };
  }

  const token = await youTubeAccessToken();
  if (!token) return { posted: false, platform: "youtube", reason: "Could not obtain a YouTube access token — check the OAuth creds/refresh token." };

  const isVertical = clip.aspect === "9:16";
  const title = (clip.title || "Clip").slice(0, 90) + (isVertical ? " #Shorts" : "");
  const descLines = [clip.hook, "", (clip.hashtags ?? []).join(" "), isVertical ? "#Shorts" : ""].filter(Boolean);
  const snippet = {
    snippet: { title, description: descLines.join("\n").slice(0, 4900), tags: (clip.hashtags ?? []).map((h) => h.replace(/^#/, "")).slice(0, 15) },
    status: { privacyStatus: privacyStatus(), selfDeclaredMadeForKids: false },
  };

  try {
    // 1) Open a resumable session.
    const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=UTF-8",
        "x-upload-content-type": "video/mp4",
        "x-upload-content-length": String(bytes.length),
      },
      body: JSON.stringify(snippet),
    });
    if (!init.ok) {
      return { posted: false, platform: "youtube", reason: `YouTube upload init failed: ${init.status} ${(await init.text()).slice(0, 200)}` };
    }
    const uploadUrl = init.headers.get("location");
    if (!uploadUrl) return { posted: false, platform: "youtube", reason: "YouTube did not return a resumable upload URL." };

    // 2) PUT the bytes.
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "video/mp4", "content-length": String(bytes.length) },
      body: new Uint8Array(bytes),
    });
    if (!put.ok) {
      return { posted: false, platform: "youtube", reason: `YouTube upload failed: ${put.status} ${(await put.text()).slice(0, 200)}` };
    }
    const done = (await put.json()) as { id?: string };
    if (!done.id) return { posted: false, platform: "youtube", reason: "YouTube upload returned no video id." };
    const url = `https://youtube.com/watch?v=${done.id}`;
    await appendLog({ level: "info", source: "clipping:poster", message: `uploaded clip ${clip.id} to YouTube (${privacyStatus()}): ${url}` });
    return { posted: true, platform: "youtube", url };
  } catch (e) {
    return { posted: false, platform: "youtube", reason: `YouTube upload error: ${e instanceof Error ? e.message : String(e)}` };
  }
}
