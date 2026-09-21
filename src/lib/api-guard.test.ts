import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enforceRateLimit, resetSharedRateLimiter } from "@/lib/api-guard";
import { resetServerEnvCache, type ServerEnv } from "@/lib/env";

/**
 * Tests for the request-level rate limit guard.
 *
 * The shared limiter is the bridge between rate-limiting logic (tested
 * exhaustively in ratelimit.test.ts) and the HTTP layer. These tests verify
 * that the guard creates a single shared limiter, delegates correctly, and
 * returns either null (continue) or a well-formed 429 Response.
 */

const MANAGED_KEYS = [
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GEMINI_FALLBACK_MODEL",
  "MAX_UPLOAD_BYTES",
  "RATE_LIMIT_MAX",
  "RATE_LIMIT_WINDOW_MS",
] as const;

const original: Record<string, string | undefined> = {};

function testEnv(overrides: Partial<ServerEnv> = {}): ServerEnv {
  return {
    GEMINI_API_KEY: "test-key",
    GEMINI_MODEL: "gemini-3.6-flash",
    GEMINI_FALLBACK_MODEL: "gemini-3.5-flash",
    MAX_UPLOAD_BYTES: 2_000_000,
    RATE_LIMIT_MAX: 3,
    RATE_LIMIT_WINDOW_MS: 60_000,
    ...overrides,
  };
}

function fakeRequest(ip = "203.0.113.1"): Request {
  return new Request("http://localhost/api/simplify", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  for (const key of MANAGED_KEYS) {
    original[key] = process.env[key];
  }
  resetSharedRateLimiter();
  resetServerEnvCache();
});

afterEach(() => {
  for (const key of MANAGED_KEYS) {
    const value = original[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetSharedRateLimiter();
  resetServerEnvCache();
});

describe("enforceRateLimit", () => {
  it("returns null for a fresh, under-limit request", () => {
    const result = enforceRateLimit(fakeRequest(), testEnv());
    expect(result).toBeNull();
  });

  it("returns a 429 Response once the limit is exhausted", async () => {
    const env = testEnv({ RATE_LIMIT_MAX: 2 });

    // First two requests are allowed.
    expect(enforceRateLimit(fakeRequest(), env)).toBeNull();
    expect(enforceRateLimit(fakeRequest(), env)).toBeNull();

    // Third request is blocked.
    const response = enforceRateLimit(fakeRequest(), env);
    expect(response).toBeInstanceOf(Response);
    expect(response!.status).toBe(429);

    const body = await response!.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toContain("Too many requests");
  });

  it("includes a Retry-After header on a 429", () => {
    const env = testEnv({ RATE_LIMIT_MAX: 1 });
    enforceRateLimit(fakeRequest(), env);

    const response = enforceRateLimit(fakeRequest(), env);
    expect(response).not.toBeNull();
    expect(response!.headers.get("retry-after")).toBeTruthy();
    expect(Number(response!.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("uses a shared limiter -- different routes drain the same budget", () => {
    const env = testEnv({ RATE_LIMIT_MAX: 2 });

    // Two requests from the same IP, different "routes" (the guard is route-agnostic).
    enforceRateLimit(fakeRequest(), env);
    enforceRateLimit(fakeRequest(), env);

    const blocked = enforceRateLimit(fakeRequest(), env);
    expect(blocked).not.toBeNull();
    expect(blocked!.status).toBe(429);
  });

  it("tracks clients independently by IP", () => {
    const env = testEnv({ RATE_LIMIT_MAX: 1 });

    enforceRateLimit(fakeRequest("10.0.0.1"), env);
    // 10.0.0.1 is now exhausted; 10.0.0.2 is fresh.
    expect(enforceRateLimit(fakeRequest("10.0.0.1"), env)).not.toBeNull();
    expect(enforceRateLimit(fakeRequest("10.0.0.2"), env)).toBeNull();
  });

  it("resetSharedRateLimiter clears state so a new limiter is created", () => {
    const env = testEnv({ RATE_LIMIT_MAX: 1 });

    enforceRateLimit(fakeRequest(), env);
    expect(enforceRateLimit(fakeRequest(), env)).not.toBeNull();

    resetSharedRateLimiter();

    // After reset, the same client is allowed again.
    expect(enforceRateLimit(fakeRequest(), env)).toBeNull();
  });
});
