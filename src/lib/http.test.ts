import { describe, expect, it } from "vitest";
import {
  jsonError,
  jsonTooManyRequests,
  contentLengthExceeded,
  type ApiErrorBody,
} from "@/lib/http";

/**
 * Tests for the shared HTTP helpers used by every API route.
 *
 * These are thin wrappers, but they form the contract that the client-side
 * error handler trusts: one shape, always a code, always a message, and
 * never a leaked stack trace. Testing them here means the routes do not need
 * to re-check the shape themselves.
 */

describe("jsonError", () => {
  it("returns a Response with the specified status code", () => {
    const r = jsonError(422, "no_clauses", "No clauses found.");
    expect(r.status).toBe(422);
  });

  it("returns the canonical error body shape", async () => {
    const r = jsonError(400, "bad_input", "Missing field.");
    const body: ApiErrorBody = await r.json();

    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("bad_input");
    expect(body.error.message).toBe("Missing field.");
  });

  it("includes the detail when provided", async () => {
    const r = jsonError(500, "unexpected", "Server error.", "stack trace snippet");
    const body: ApiErrorBody = await r.json();
    expect(body.error.detail).toBe("stack trace snippet");
  });

  it("omits detail when it is undefined", async () => {
    const r = jsonError(503, "misconfigured", "No key.");
    const body: ApiErrorBody = await r.json();
    expect(body.error.detail).toBeUndefined();
  });

  it("scrubs excessively long detail strings", async () => {
    const longDetail = "x".repeat(2000);
    const r = jsonError(500, "unexpected", "Error.", longDetail);
    const body: ApiErrorBody = await r.json();
    // Detail should be truncated, not the full 2000 chars.
    expect(body.error.detail!.length).toBeLessThan(700);
    expect(body.error.detail!.endsWith("…")).toBe(true);
  });

  it("treats whitespace-only detail as undefined", async () => {
    const r = jsonError(400, "empty", "Bad.", "   ");
    const body: ApiErrorBody = await r.json();
    expect(body.error.detail).toBeUndefined();
  });
});

describe("jsonTooManyRequests", () => {
  it("returns a 429 status", () => {
    const r = jsonTooManyRequests(5000, "Slow down.");
    expect(r.status).toBe(429);
  });

  it("sets a Retry-After header in seconds", () => {
    const r = jsonTooManyRequests(30_000, "Wait.");
    expect(r.headers.get("retry-after")).toBe("30");
  });

  it("rounds sub-second waits up to 1, not 0", () => {
    // 0 seconds would invite an immediate retry storm.
    const r = jsonTooManyRequests(500, "Wait.");
    expect(r.headers.get("retry-after")).toBe("1");
  });

  it("rounds up fractional seconds", () => {
    const r = jsonTooManyRequests(1500, "Wait.");
    expect(r.headers.get("retry-after")).toBe("2");
  });

  it("returns the canonical error body with code rate_limited", async () => {
    const r = jsonTooManyRequests(60_000, "Too fast.");
    const body: ApiErrorBody = await r.json();
    expect(body.error.code).toBe("rate_limited");
    expect(body.error.message).toBe("Too fast.");
    expect(body.error.detail).toContain("60 second");
  });

  it("uses singular 'second' for exactly 1s", async () => {
    const r = jsonTooManyRequests(1000, "Retry.");
    const body: ApiErrorBody = await r.json();
    expect(body.error.detail).toContain("1 second");
    expect(body.error.detail).not.toContain("1 seconds");
  });
});

describe("contentLengthExceeded", () => {
  it("returns false when no content-length header is present", () => {
    const req = new Request("http://localhost/test", { method: "POST" });
    expect(contentLengthExceeded(req, 1_000_000)).toBe(false);
  });

  it("returns false for a request within the limit", () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "500000" },
    });
    expect(contentLengthExceeded(req, 1_000_000)).toBe(false);
  });

  it("returns true for a request exceeding the limit plus slack", () => {
    // Default slack is 64_000, so maxBytes=1_000_000 allows up to 1_064_000.
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "1200000" },
    });
    expect(contentLengthExceeded(req, 1_000_000)).toBe(true);
  });

  it("accounts for the configurable slack", () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "1050000" },
    });
    // With 100k slack, 1_050_000 < 1_000_000 + 100_000 → false.
    expect(contentLengthExceeded(req, 1_000_000, 100_000)).toBe(false);
    // With 10k slack, 1_050_000 > 1_000_000 + 10_000 → true.
    expect(contentLengthExceeded(req, 1_000_000, 10_000)).toBe(true);
  });

  it("handles non-numeric content-length gracefully", () => {
    const req = new Request("http://localhost/test", {
      method: "POST",
      headers: { "content-length": "not-a-number" },
    });
    expect(contentLengthExceeded(req, 1_000_000)).toBe(false);
  });
});
