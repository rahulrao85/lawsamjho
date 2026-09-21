import { mkdir, appendFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local usage logging and document retention.
 *
 * Explicitly requested by the operator, not the default posture of the rest of
 * this app: everywhere else, nothing survives past the request that needed it.
 * This module exists specifically so the operator can see who is using the
 * deployed instance and keep a local copy of what gets uploaded during this
 * period. It is disclosed to visitors in the page footer rather than silent.
 *
 * Never committed to the repo -- DATA_DIR is gitignored and lives only on the
 * deployment host, mounted as a volume so it survives a container restart.
 *
 * A logging failure must never break the feature the visitor is waiting on:
 * every write here is fire-and-forget and swallows its own errors.
 */

/**
 * Read lazily, not as a module-level constant: a top-level `const DATA_DIR =
 * process.env.AUDIT_DATA_DIR ?? "./data"` reads the environment exactly once,
 * at import time. A test that sets `process.env.AUDIT_DATA_DIR` in its own
 * `beforeEach` -- after this module has already been imported once, which in
 * a shared Vitest worker is the common case -- would then silently write to
 * the real `./data` on disk instead of its intended temp directory. This bit
 * a real test file that shipped without catching it: every run wrote fake
 * uploads and log lines into the operator's actual audit log.
 */
function dataDir(): string {
  return process.env.AUDIT_DATA_DIR?.trim() || "./data";
}
function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}
function logFile(): string {
  return path.join(dataDir(), "access.log");
}

/** Test seam: forces the next call to re-read AUDIT_DATA_DIR and re-create it. */
export function resetAuditDirCache(): void {
  ensured = null;
}

let ensured: Promise<void> | null = null;
function ensureDirs(): Promise<void> {
  if (!ensured) ensured = mkdir(uploadsDir(), { recursive: true }).then(() => undefined);
  return ensured;
}

export type AccessEvent = {
  route: string;
  /** From clientKeyFromHeaders -- the left-most x-forwarded-for entry, or "unknown". */
  clientKey: string;
  status: number;
  latencyMs: number;
  filename?: string;
  question?: string;
};

/** One line per request: who, what route, what happened, how long it took. */
export async function logAccess(event: AccessEvent): Promise<void> {
  try {
    await ensureDirs();
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    await appendFile(logFile(), `${line}\n`, "utf8");
  } catch {
    // Never let logging be the reason a real request fails.
  }
}

/** Strip everything that is not safe in a filename; keep it short. */
function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return cleaned.slice(-120) || "document";
}

/**
 * Save a copy of an uploaded document. Returns the stored filename, or null if
 * the write failed -- callers do not need to (and should not) fail the request
 * over this, since it is a retention feature, not the feature itself.
 */
export async function saveUpload(bytes: Uint8Array, filename: string): Promise<string | null> {
  try {
    await ensureDirs();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const unique = `${stamp}-${Math.random().toString(36).slice(2, 8)}-${safeName(filename)}`;
    await writeFile(path.join(uploadsDir(), unique), bytes);
    return unique;
  } catch {
    return null;
  }
}
