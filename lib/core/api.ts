import { NextResponse } from "next/server";

import type { ApiResponse } from "@/types/api";

/**
 * lib/core/api.ts — the JSON envelope helpers every route returns (standalone build).
 * jsonOk/jsonError mirror bert-ai so ported routes work unchanged.
 */

export function jsonOk<T>(data: T, status = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

export function jsonError(code: string, message: string, status = 400, details?: unknown): NextResponse<ApiResponse<never>> {
  return NextResponse.json({ ok: false, error: { code, message, details } }, { status });
}
