import type { ServerEnv } from "@/lib/env";
import { jsonTooManyRequests } from "@/lib/http";
import { clientKeyFromHeaders, createRateLimiter, type RateLimiter } from "@/lib/ratelimit";

/**
 * The request-level rate limit guard.
 *
 * One limiter for the whole app rather than one per endpoint, so a caller
 * cannot take `RATE_LIMIT_MAX` uploads *and* `RATE_LIMIT_MAX` questions in the
 * same window. The resource being protected is model calls, and those do not
 * care which route asked for them.
 *
 * The limiter is created once and reused, because a per-request limiter would
 * count every request as the first one and limit nothing.
 */

let sharedLimiter: RateLimiter | undefined;

/** Test seam -- also used if the configured limit changes between calls. */
export function resetSharedRateLimiter(): void {
  sharedLimiter = undefined;
}

function getLimiter(config: ServerEnv): RateLimiter {
  if (sharedLimiter) return sharedLimiter;
  sharedLimiter = createRateLimiter({
    max: config.RATE_LIMIT_MAX,
    windowMs: config.RATE_LIMIT_WINDOW_MS,
  });
  return sharedLimiter;
}

/**
 * Returns the 429 response to send, or null to continue.
 *
 * Called before the body is read, so a throttled request costs nothing -- not a
 * parse, not an extraction, and not a model call.
 */
export function enforceRateLimit(request: Request, config: ServerEnv): Response | null {
  const decision = getLimiter(config).check(clientKeyFromHeaders(request.headers));
  if (decision.allowed) return null;

  return jsonTooManyRequests(
    decision.retryAfterMs,
    `Too many requests. This tool allows ${decision.limit} per ${Math.round(
      config.RATE_LIMIT_WINDOW_MS / 1000,
    )} seconds, so that one caller cannot exhaust a shared model quota.`,
  );
}
