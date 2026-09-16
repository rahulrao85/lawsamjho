import { describe, expect, it } from "vitest";
import { clientKeyFromHeaders, createRateLimiter } from "@/lib/ratelimit";

const CONFIG = { max: 3, windowMs: 1000 };

describe("createRateLimiter — the window", () => {
  it("allows exactly `max` requests, then blocks", () => {
    const limiter = createRateLimiter(CONFIG);
    const t = 10_000;

    expect(limiter.check("a", t).allowed).toBe(true);
    expect(limiter.check("a", t).allowed).toBe(true);
    expect(limiter.check("a", t).allowed).toBe(true);

    const blocked = limiter.check("a", t);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.limit).toBe(3);
  });

  it("counts down the remaining allowance", () => {
    const limiter = createRateLimiter(CONFIG);
    expect(limiter.check("a", 0).remaining).toBe(2);
    expect(limiter.check("a", 0).remaining).toBe(1);
    expect(limiter.check("a", 0).remaining).toBe(0);
  });

  it("consumes one unit per check -- the call is the consumption", () => {
    // There is no separate peek step, on purpose: a route cannot forget to
    // record the request it just made.
    const limiter = createRateLimiter({ max: 2, windowMs: 1000 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("lets the caller back in once the window expires", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 3; i += 1) limiter.check("a", 0);

    expect(limiter.check("a", 999).allowed).toBe(false);
    // Exactly at the boundary it is a fresh window, and this check is the first
    // request in it, so it leaves one fewer than the full allowance.
    expect(limiter.check("a", 1000).allowed).toBe(true);
    expect(limiter.check("a", 1000).remaining).toBe(1);
  });

  it("reports how long to wait", () => {
    const limiter = createRateLimiter(CONFIG);
    // The window opens on the first request (400) and closes at 1400.
    for (let i = 0; i < 3; i += 1) limiter.check("a", 400);

    expect(limiter.check("a", 400).retryAfterMs).toBe(1000);
    expect(limiter.check("a", 900).retryAfterMs).toBe(500);
    expect(limiter.check("a", 1399).retryAfterMs).toBe(1);
  });

  it("starts the window at the first request, not on a wall-clock boundary", () => {
    const limiter = createRateLimiter(CONFIG);
    limiter.check("a", 500);
    limiter.check("a", 900);
    limiter.check("a", 1200);
    // Still inside the window that began at 500.
    expect(limiter.check("a", 1300).allowed).toBe(false);
    expect(limiter.check("a", 1500).allowed).toBe(true);
  });
});

describe("createRateLimiter — keys are independent", () => {
  it("does not let one client exhaust another's allowance", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 3; i += 1) limiter.check("a", 0);

    expect(limiter.check("a", 0).allowed).toBe(false);
    // b is untouched, so its own first check still has the full window ahead.
    const first = limiter.check("b", 0);
    expect(first.allowed).toBe(true);
    expect(first.remaining).toBe(2);
  });

  it("tracks one window per key", () => {
    const limiter = createRateLimiter(CONFIG);
    limiter.check("a", 0);
    limiter.check("b", 0);
    expect(limiter.size()).toBe(2);
  });
});

describe("createRateLimiter — bounded memory", () => {
  it("drops expired windows rather than growing without limit", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 100, maxKeys: 10 });

    for (let i = 0; i < 500; i += 1) limiter.check(`client-${i}`, 0);
    expect(limiter.size()).toBeLessThanOrEqual(10);

    // A later request prunes the now-expired ones.
    limiter.check("late", 1000);
    expect(limiter.size()).toBe(1);
  });

  it("stays bounded even when every window is still live", () => {
    // A flood that never expires must not be able to grow the map forever.
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000_000, maxKeys: 50 });
    for (let i = 0; i < 2000; i += 1) limiter.check(`flood-${i}`, 0);
    expect(limiter.size()).toBeLessThanOrEqual(50);
  });

  it("forgives a flooded-out client rather than locking everyone out", () => {
    // Eviction removes live windows, so a legitimate client that arrives after
    // a flood still gets served. Failing closed here would be the wrong choice.
    const limiter = createRateLimiter({ max: 1, windowMs: 1_000_000, maxKeys: 10 });
    for (let i = 0; i < 100; i += 1) limiter.check(`flood-${i}`, 0);
    expect(limiter.check("latecomer", 0).allowed).toBe(true);
  });
});

describe("createRateLimiter — configuration hygiene", () => {
  it("treats a nonsense max or window as 1 rather than disabling itself", () => {
    // A limiter that silently stops limiting is worse than a strict one.
    const limiter = createRateLimiter({ max: 0, windowMs: 0 });
    expect(limiter.check("a", 0).allowed).toBe(true);
    expect(limiter.check("a", 0).allowed).toBe(false);
  });

  it("resets cleanly", () => {
    const limiter = createRateLimiter(CONFIG);
    for (let i = 0; i < 3; i += 1) limiter.check("a", 0);
    limiter.reset();
    expect(limiter.check("a", 0).allowed).toBe(true);
  });
});

describe("clientKeyFromHeaders", () => {
  it("takes the first entry of x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" });
    expect(clientKeyFromHeaders(headers)).toBe("203.0.113.7");
  });

  it("trims whitespace", () => {
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "  198.51.100.4  " }))).toBe(
      "198.51.100.4",
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientKeyFromHeaders(new Headers({ "x-real-ip": "192.0.2.9" }))).toBe("192.0.2.9");
  });

  it("uses one shared bucket when there is no usable header", () => {
    // Shared quota throttles everyone slightly; a per-request unique key would
    // let a caller with no headers through unlimited, which is worse.
    expect(clientKeyFromHeaders(new Headers())).toBe("unknown");
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "   " }))).toBe("unknown");
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": "" }))).toBe("unknown");
  });

  it("ignores an absurdly long header rather than storing it", () => {
    const huge = "a".repeat(500);
    expect(clientKeyFromHeaders(new Headers({ "x-forwarded-for": huge }))).toBe("unknown");
  });
});
