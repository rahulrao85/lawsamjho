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

const DATA_DIR = process.env.AUDIT_DATA_DIR?.trim() || "./data";
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const LOG_FILE = path.join(DATA_DIR, "access.log");

let ensured: Promise<void> | null = null;
function ensureDirs(): Promise<void> {
  if (!ensured) ensured = mkdir(UPLOADS_DIR, { recursive: true }).then(() => undefined);
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
    await appendFile(LOG_FILE, `${line}\n`, "utf8");
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
    await writeFile(path.join(UPLOADS_DIR, unique), bytes);
    return unique;
  } catch {
    return null;
  }
}
