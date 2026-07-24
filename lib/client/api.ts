import type { ApiResponse } from "@/types/api";

/**
 * lib/client/api.ts — client-safe fetch helpers (standalone build). They unwrap the
 * ApiResponse envelope and throw a typed error on `{ ok: false }`. Browser-only:
 * never import server-only modules here.
 */

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  let env: ApiResponse<T>;
  try {
    env = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ApiClientError("BAD_RESPONSE", `Non-JSON response (${res.status})`, res.status);
  }
  if (!env.ok) throw new ApiClientError(env.error.code, env.error.message, res.status, env.error.details);
  return env.data;
}

export async function apiGet<T>(url: string, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(await fetch(url, { headers: { accept: "application/json" }, signal }));
}

export async function apiPost<T>(url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return unwrap<T>(
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    }),
  );
}

/** Human-readable message from any thrown error (typed API error or otherwise). */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}
