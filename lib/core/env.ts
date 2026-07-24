/**
 * lib/core/env.ts — the small slice of environment config the clipping operation needs.
 *
 * Standalone bertclips build: mirrors bert-ai's env surface for just the two accessors
 * the clipping + promo code calls, so ported modules work unchanged.
 */

export type DeploymentMode = "local" | "edge";

export const env = {
  /** Directory the atomic JSON stores live under (default `.bertos-runtime`). */
  runtimeDir(): string {
    return (process.env.BERTOS_RUNTIME_DIR || "").trim() || ".bertos-runtime";
  },
  /** "local" enables the engine, promo rail, and factory bridge; anything else is read-only. */
  deploymentMode(): DeploymentMode {
    return (process.env.BERTOS_DEPLOYMENT_MODE || "").trim().toLowerCase() === "local" ? "local" : "edge";
  },
};
