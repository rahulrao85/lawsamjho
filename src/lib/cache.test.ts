import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResultCache, hashContent } from "@/lib/cache";

describe("hashContent", () => {
  it("is stable for the same text", () => {
    expect(hashContent("hello world")).toBe(hashContent("hello world"));
  });

  it("differs for different text", () => {
    expect(hashContent("hello world")).not.toBe(hashContent("hello world!"));
  });

  it("is sensitive to whitespace, not just words", () => {
    expect(hashContent("a b")).not.toBe(hashContent("a  b"));
  });
});

describe("createResultCache", () => {
  it("returns undefined for a key that was never set", () => {
    const cache = createResultCache<string>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("returns what was set", () => {
    const cache = createResultCache<{ n: number }>();
    cache.set("a", { n: 1 });
    expect(cache.get("a")).toEqual({ n: 1 });
  });

  it("overwrites an existing key rather than duplicating it", () => {
    const cache = createResultCache<number>();
    cache.set("a", 1);
    cache.set("a", 2);
    expect(cache.get("a")).toBe(2);
    expect(cache.size()).toBe(1);
  });

  describe("TTL expiry", () => {
    // Mocked Date.now(), not a real setTimeout: a real one made this test's
    // pass/fail depend on the CI machine's actual scheduling under load,
    // which is exactly the kind of timing-sensitive test that is fine nine
    // times out of ten and flakes on the tenth for a reason that has nothing
    // to do with the cache.
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("expires an entry once its TTL has passed", () => {
      const cache = createResultCache<string>({ ttlMs: 10 });
      cache.set("a", "value");
      expect(cache.get("a")).toBe("value");

      vi.advanceTimersByTime(11);

      expect(cache.get("a")).toBeUndefined();
    });

    it("does not expire an entry before its TTL has passed", () => {
      const cache = createResultCache<string>({ ttlMs: 10 });
      cache.set("a", "value");

      vi.advanceTimersByTime(9);

      expect(cache.get("a")).toBe("value");
    });
  });

  it("evicts the oldest entries once over the configured cap", () => {
    const cache = createResultCache<number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("c", 3);

    // "a" was inserted first and the cap is 2, so it is the one evicted.
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.size()).toBe(2);
  });

  it("treats a refreshed key as newest, not still the oldest", () => {
    const cache = createResultCache<number>({ maxEntries: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // "a" refreshed -- "b" is now the oldest
    cache.set("c", 3); // pushes the cache over its cap of 2

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
  });

  it("never grows past maxEntries even under a sustained burst", () => {
    const cache = createResultCache<number>({ maxEntries: 5 });
    for (let i = 0; i < 50; i += 1) cache.set(`key-${i}`, i);
    expect(cache.size()).toBeLessThanOrEqual(5);
  });
});
