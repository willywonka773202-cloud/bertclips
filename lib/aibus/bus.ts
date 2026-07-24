import "server-only";

/**
 * Standalone bertclips: the AI activity bus is a no-op. In bert-ai this streams loop
 * events to a cockpit feed; here the factory tick still runs, it just doesn't publish.
 */
export function publishAiEvent(_event: unknown): void {
  // no-op in the standalone build
}
