import { lazy, type ComponentType } from "react";

/** Lazy import that retries once and hard-reloads once on stale or transient chunk failures. */
export function lazyWithRetry<T extends { default: ComponentType<any> }>(
  factory: () => Promise<T>
) {
  return lazy(async () => {
    const RELOAD_KEY = "lovable_chunk_reloaded";
    try {
      return await factory();
    } catch (err: any) {
      const msg = String(err?.message || err);
      const isChunkError =
        err?.name === "ChunkLoadError" ||
        /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed|dynamically imported module/i.test(msg);
      if (isChunkError) {
        // Retry once in-memory (might be a transient network blip)
        try {
          return await factory();
        } catch {
          // Still failing - almost certainly a stale deploy. Hard-reload once.
          if (!sessionStorage.getItem(RELOAD_KEY)) {
            sessionStorage.setItem(RELOAD_KEY, "1");
            window.location.reload();
            // Return a placeholder so React doesn't throw before reload kicks in.
            return { default: () => null } as unknown as T;
          }
        }
      }
      throw err;
    }
  });
}

