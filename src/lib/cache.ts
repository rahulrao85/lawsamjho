import { createHash } from "node:crypto";

/**
 * Result cache, keyed by document content.
 *
 * Re-uploading the exact same document today costs a fresh ~20s model call
 * every time -- the pipeline has no memory of ever having seen it. This closes
 * that gap: the key is a hash of the extracted text (post-extraction, so a
 * scanned PDF and its vision-transcribed text hash the same as if it had a
 * real text layer), not the file bytes, so re-uploading the identical document
 * as a different file name or file type is still a hit.
 *
 * In-memory and bounded, the same honest fit as ratelimit.ts and for the same
 * reason: one container on one VPS. It would not be correct behind more than
 * one replica without moving the store out of process, and this says so
 * rather than pretending otherwise. A restart clears it, which is fine --
 * every result here is fully reconstructible from the same document.
 */

export type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

export type ResultCache<T> = {
  get(key: string): T | undefined;
  set(key: string, value: T): void;
  size(): number;
};

const DEFAULT_MAX_ENTRIES = 200;
const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export function createResultCache<T>(config?: {
  maxEntries?: number;
  ttlMs?: number;
}): ResultCache<T> {
  const maxEntries = Math.max(1, Math.floor(config?.maxEntries ?? DEFAULT_MAX_ENTRIES));
  const ttlMs = Math.max(1, Math.floor(config?.ttlMs ?? DEFAULT_TTL_MS));
  const store = new Map<string, CacheEntry<T>>();

  /**
   * Evict expired entries first, oldest-inserted next if still over budget.
   * Map preserves insertion order, so re-`set`ting a key (which deletes then
   * re-inserts, see below) correctly refreshes its eviction priority too.
   */
  function prune(now: number): void {
    if (store.size <= maxEntries) return;

    for (const [key, entry] of store) {
      if (now >= entry.expiresAt) store.delete(key);
    }

    if (store.size <= maxEntries) return;

    const excess = store.size - maxEntries;
    const oldestKeys = [...store.keys()].slice(0, excess);
    for (const key of oldestKeys) store.delete(key);
  }

  return {
    get(key: string): T | undefined {
      const entry = store.get(key);
      if (!entry) return undefined;

      if (Date.now() >= entry.expiresAt) {
        store.delete(key);
        return undefined;
      }

      return entry.value;
    },

    set(key: string, value: T): void {
      // Delete-then-set moves the key to the end of Map's iteration order, so
      // a refreshed entry is treated as newest for eviction purposes too.
      store.delete(key);
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      prune(Date.now());
    },

    size(): number {
      return store.size;
    },
  };
}

/** Stable content key -- not a security boundary, just a cache key. */
export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
