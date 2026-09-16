/**
 * Rate limiting.
 *
 * In-memory and fixed-window. That is a deliberate fit for how this is
 * deployed: one container on one VPS behind Caddy, so a per-process counter is
 * the whole truth. It would NOT be correct behind more than one replica, and it
 * says so here rather than pretending otherwise -- if this ever scales out, the
 * store has to move out of process too.
 *
 * The implementation is a plain function over injected time, so the window
 * boundary is testable without sleeping through it.
 */

export type RateLimitConfig = {
  /** Requests permitted per window, per key. */
  max: number;
  windowMs: number;
  /**
   * Ceiling on tracked keys. Without it, a client cycling source addresses
   * turns the map itself into the denial of service.
   */
  maxKeys?: number;
};

export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Milliseconds until this key's window resets. */
  retryAfterMs: number;
};

const DEFAULT_MAX_KEYS = 5_000;

type Window = { count: number; resetAt: number };

export type RateLimiter = {
  /**
   * Test the key and consume one unit of its allowance. There is no separate
   * "peek": every call counts, which is what makes it safe to call from a route
   * without a second step that could be forgotten.
   */
  check(key: string, now?: number): RateLimitDecision;
  /** Tracked keys, for tests and diagnostics. */
  size(): number;
  reset(): void;
};

export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const max = Math.max(1, Math.floor(config.max));
  const windowMs = Math.max(1, Math.floor(config.windowMs));
  const maxKeys = Math.max(1, Math.floor(config.maxKeys ?? DEFAULT_MAX_KEYS));
  const windows = new Map<string, Window>();

  /**
   * Keep the map bounded. Expired windows go first -- they are free to drop --
   * and only if that is not enough do we evict live windows, oldest reset
   * first. Evicting a live window forgives that client early, which is the
   * right way to fail: a flood should not be able to lock out everybody else.
   */
  function prune(now: number): void {
    if (windows.size <= maxKeys) return;

    for (const [key, window] of windows) {
      if (now >= window.resetAt) windows.delete(key);
    }

    if (windows.size <= maxKeys) return;

    const oldest = [...windows.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    const excess = windows.size - maxKeys;
    for (let index = 0; index < excess; index += 1) {
      windows.delete(oldest[index][0]);
    }
  }

  return {
    check(key: string, now: number = Date.now()): RateLimitDecision {
      const existing = windows.get(key);

      // A missing window and an expired one are the same thing: start fresh.
      if (!existing || now >= existing.resetAt) {
        windows.set(key, { count: 1, resetAt: now + windowMs });
        prune(now);
        return { allowed: true, limit: max, remaining: max - 1, retryAfterMs: windowMs };
      }

      if (existing.count >= max) {
        return {
          allowed: false,
          limit: max,
          remaining: 0,
          retryAfterMs: Math.max(0, existing.resetAt - now),
        };
      }

      existing.count += 1;
      return {
        allowed: true,
        limit: max,
        remaining: Math.max(0, max - existing.count),
        retryAfterMs: Math.max(0, existing.resetAt - now),
      };
    },

    size(): number {
      return windows.size;
    },

    reset(): void {
      windows.clear();
    },
  };
}

/**
 * Identify the client.
 *
 * Behind Caddy the left-most `x-forwarded-for` entry is the original peer;
 * Caddy appends rather than replaces, so the first value is the one we want.
 * A missing or unparseable header collapses to a single shared bucket, which is
 * the safe direction -- shared quota throttles everyone a little rather than
 * letting one caller through unlimited.
 */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first && first.length <= 64) return first;
  }

  const real = headers.get("x-real-ip");
  if (real && real.trim().length <= 64) return real.trim();

  return "unknown";
}
