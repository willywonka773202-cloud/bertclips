import { NextRequest } from "next/server";
import { createReadStream, promises as fs } from "node:fs";
import { Readable } from "node:stream";

import { clipFilePath } from "@/lib/clipping/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/clipping/media/[id] — stream a rendered clip's mp4 for in-cockpit preview
 * and download. The id is strictly validated (clip_ + hex) so it can only ever resolve
 * to a file inside the clipping media dir — no path traversal. Supports HTTP range so
 * the <video> element can seek.
 */

interface Params {
  params: Promise<{ id: string }>;
}

function toWeb(stream: Readable): ReadableStream {
  return Readable.toWeb(stream) as unknown as ReadableStream;
}

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
  const { id } = await params;
  if (!/^clip_[a-z0-9]+$/.test(id)) return new Response("Bad clip id", { status: 400 });

  const file = clipFilePath(id);
  let size: number;
  try {
    const stat = await fs.stat(file);
    size = stat.size;
  } catch {
    return new Response("Clip not found", { status: 404 });
  }

  const base: Record<string, string> = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=60",
  };

  const range = request.headers.get("range");
  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match) {
    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : size - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= size) end = size - 1;
    if (start > end || start >= size) {
      return new Response("Range not satisfiable", { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    return new Response(toWeb(createReadStream(file, { start, end })), {
      status: 206,
      headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
    });
  }

  return new Response(toWeb(createReadStream(file)), {
    status: 200,
    headers: { ...base, "Content-Length": String(size) },
  });
}
