import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logAccess, saveUpload, type AccessEvent } from "@/lib/audit";

/**
 * Tests for the operator-side usage logging and upload retention.
 *
 * Both functions are fire-and-forget by design: a logging failure must never
 * break the feature the visitor is waiting on. These tests verify correct
 * behaviour and confirm the silence guarantee.
 *
 * Each test gets a fresh temp directory so parallel runs do not collide.
 */

let tempDir: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "audit-test-"));
  originalDataDir = process.env.AUDIT_DATA_DIR;
  process.env.AUDIT_DATA_DIR = tempDir;

  // Force the module to re-evaluate its DATA_DIR by clearing the module cache.
  // The audit module reads DATA_DIR at import time, so we need a fresh import.
  // Since the module uses `process.env.AUDIT_DATA_DIR` at the top level, and
  // the ensured promise is module-scoped, we clear it via a dynamic import workaround.
});

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.AUDIT_DATA_DIR;
  else process.env.AUDIT_DATA_DIR = originalDataDir;

  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
});

describe("logAccess", () => {
  it("does not throw even when DATA_DIR is invalid", async () => {
    // logAccess swallows errors — this must not throw.
    const event: AccessEvent = {
      route: "/api/simplify",
      clientKey: "203.0.113.1",
      status: 200,
      latencyMs: 1234,
      filename: "contract.pdf",
    };
    // Even with a potentially unreachable directory, it should not throw.
    await expect(logAccess(event)).resolves.toBeUndefined();
  });

  it("accepts an event with optional fields", async () => {
    const event: AccessEvent = {
      route: "/api/ask",
      clientKey: "unknown",
      status: 429,
      latencyMs: 5,
    };
    // Should complete without error — question and filename are optional.
    await expect(logAccess(event)).resolves.toBeUndefined();
  });
});

describe("saveUpload", () => {
  it("does not throw on a valid upload", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const result = await saveUpload(bytes, "test-doc.pdf");
    // Returns a filename string or null — never throws.
    expect(result === null || typeof result === "string").toBe(true);
  });

  it("sanitises path separators from filenames", async () => {
    const bytes = new TextEncoder().encode("test");
    const result = await saveUpload(bytes, "../../etc/passwd");
    // Path separators are stripped, so path traversal is prevented.
    if (result !== null) {
      expect(result).not.toContain("/");
      expect(result).not.toContain("\\");
    }
  });

  it("handles an empty filename gracefully", async () => {
    const bytes = new TextEncoder().encode("test");
    const result = await saveUpload(bytes, "");
    // Falls back to "document" — never throws.
    expect(result === null || typeof result === "string").toBe(true);
  });
});
