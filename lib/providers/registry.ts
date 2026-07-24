import type { ProviderId } from "@/types/provider";

export interface RegistryEntry {
  billing: "free" | "local" | "paid";
}

/** No bundled registry in the standalone build. */
export function getRegistryEntry(_id: ProviderId): RegistryEntry | undefined {
  return undefined;
}
