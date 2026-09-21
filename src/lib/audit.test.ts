import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logAccess, saveUpload, resetAuditDirCache, type AccessEvent } from "@/lib/audit";

/**
 * Tests for the operator-side usage logging and upload retention.
 *
 * Both functions are fire-and-forget by design: a logging failure must never
 * break the feature the visitor is waiting on. These tests verify correct
 * behaviour AND that isolation actually holds -- the first version of this
 * file set AUDIT_DATA_DIR in beforeEach without calling resetAuditDirCache(),
 * so audit.ts (which reads the env var once and caches the resulting
 * directory) kept using whatever directory it saw on its first call in the
 * process -- silently writing every test run's fake uploads and log lines
 * into the real ./data on disk. Every test here asserts the file actually
 * landed in tempDir, not just that the call didn't throw, specifically so
 * that regression cannot recur unnoticed.
 */

let tempDir: string;
let originalDataDir: string | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "audit-test-"));
  originalDataDir = process.env.AUDIT_DATA_DIR;
  process.env.AUDIT_DATA_DIR = tempDir;
  resetAuditDirCache();
});

afterEach(async () => {
  if (originalDataDir === undefined) delete process.env.AUDIT_DATA_DIR;
  else process.env.AUDIT_DATA_DIR = originalDataDir;
  resetAuditDirCache();

  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
});

describe("logAccess", () => {
  it("writes the event into the configured AUDIT_DATA_DIR, not the default", async () => {
    const event: AccessEvent = {
      route: "/api/simplify",
      clientKey: "203.0.113.1",
      status: 200,
      latencyMs: 1234,
      filename: "contract.pdf",
    };
    await logAccess(event);

    const logPath = path.join(tempDir, "access.log");
    const content = await readFile(logPath, "utf8");
    const parsed = JSON.parse(content.trim());
    expect(parsed).toMatchObject(event);
  });

  it("does not throw even when the directory cannot be created", async () => {
    // A path through a file (not a directory) cannot have a subdirectory
    // created under it -- mkdir must fail, and logAccess must swallow that.
    process.env.AUDIT_DATA_DIR = path.join(tempDir, "not-a-real-fs-path", "nested");
    resetAuditDirCache();

    await expect(
      logAccess({ route: "/api/ask", clientKey: "unknown", status: 429, latencyMs: 5 }),
    ).resolves.toBeUndefined();
  });
});

describe("saveUpload", () => {
  it("writes the file into the configured AUDIT_DATA_DIR, not the default", async () => {
    const bytes = new TextEncoder().encode("hello world");
    const result = await saveUpload(bytes, "test-doc.pdf");

    expect(result).not.toBeNull();
    const written = await readFile(path.join(tempDir, "uploads", result!));
    expect(new TextDecoder().decode(written)).toBe("hello world");

    // And, just as important, it did NOT land next to the real repo's data/.
    const realUploadsDir = path.join(process.cwd(), "data", "uploads");
    const realFiles = await readdir(realUploadsDir).catch(() => [] as string[]);
    expect(realFiles).not.toContain(result);
  });

  it("sanitises path separators from filenames", async () => {
    const bytes = new TextEncoder().encode("test");
    const result = await saveUpload(bytes, "../../etc/passwd");

    expect(result).not.toBeNull();
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");

    const stored = await readdir(path.join(tempDir, "uploads"));
    expect(stored).toContain(result);
  });

  it("falls back to 'document' for an empty filename", async () => {
    const bytes = new TextEncoder().encode("test");
    const result = await saveUpload(bytes, "");

    expect(result).not.toBeNull();
    expect(result).toContain("document");
  });
});
