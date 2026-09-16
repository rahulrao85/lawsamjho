import {
  CLAUSE_ID_PREFIX,
  clauseId,
  isPreambleId,
  PREAMBLE_ID,
  parseClauseId,
} from "@/lib/segment";

/**
 * The citation gate.
 *
 * The model is asked to cite clause IDs. It will sometimes invent them --
 * "CLAUSE-14" in a document with nine clauses, or "Section 7" that does not
 * exist. Nothing it returns reaches the screen until it has been checked
 * against the set of IDs the segmenter actually produced.
 *
 * Three deliberate choices:
 *
 * 1. **Canonicalise before rejecting.** Models write "CLAUSE-3", "clause 3",
 *    "3", "Clause 3." and `[CLAUSE-03]` for the same thing. Treating those as
 *    inventions would throw away correct citations and make the tool look
 *    broken. Canonicalising is not the same as trusting: the canonical form
 *    still has to exist.
 * 2. **Drop the whole item, not just the bad ID.** A sentence whose only
 *    citation was invented is an unsupported claim. Showing it with the
 *    citation quietly removed would be worse than not showing it.
 * 3. **Count everything.** The discarded count is surfaced in the UI, because
 *    a gate nobody can see is indistinguishable from no gate at all.
 */

export type CitationReport = {
  /** Individual citations that matched a real clause. */
  verifiedCount: number;
  /** Individual citations dropped because no such clause exists. */
  discardedCount: number;
  /** Items removed entirely, because nothing they cited survived. */
  droppedItemCount: number;
  /** Distinct invented references, for display. Capped for readability. */
  inventedIds: string[];
};

export type Resolved<T> = {
  value: T;
  /** Canonical, verified clause IDs. Guaranteed non-empty. */
  clauseIds: string[];
};

const MAX_REPORTED_INVENTED_IDS = 8;

const SURROUNDING_NOISE = /^[\s[("'`]+|[\s\])"'`:.,;]+$/g;

/** "clause 3.", "#3", "¶3", "CLAUSE-03" -> the number 3. */
const NUMBER_ONLY =
  /^(?:clause|sec|section|art|article|para|paragraph|¶|#)?[\s\-_#.]*(\d{1,4})[.)]?$/i;

/**
 * Map one raw reference onto a real clause ID, or null if there is no such
 * clause. Returning null is the point: it is what makes the gate a gate.
 */
export function canonicaliseClauseId(
  raw: string,
  known: ReadonlySet<string>,
): string | null {
  if (typeof raw !== "string") return null;

  const cleaned = raw.trim().replace(SURROUNDING_NOISE, "").replace(/\s+/g, " ");
  if (cleaned.length === 0) return null;

  // A leading sign is never a clause reference, and the separator class below
  // would otherwise happily read "-1" as clause 1.
  if (/^[-+]/.test(cleaned)) return null;

  // Already exactly right.
  const exact = cleaned.toUpperCase();
  if (known.has(exact)) return exact;

  if (isPreambleId(cleaned)) {
    return known.has(PREAMBLE_ID) ? PREAMBLE_ID : null;
  }

  // A bare or loosely-prefixed number.
  const numberMatch = NUMBER_ONLY.exec(cleaned);
  if (numberMatch) {
    const index = Number(numberMatch[1]);
    if (index >= 1) {
      const candidate = clauseId(index);
      if (known.has(candidate)) return candidate;
    }
    return null;
  }

  // A CLAUSE-nn-shaped string that is off-spec: CLAUSE-3, CLAUSE_003, CLAUSE-.
  if (new RegExp(`^${CLAUSE_ID_PREFIX}[\\s\\-_]*\\d{1,4}$`, "i").test(cleaned)) {
    const index = parseClauseId(`CLAUSE-${/\d{1,4}/.exec(cleaned)![0]}`);
    if (index !== null) {
      const candidate = clauseId(index);
      if (known.has(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Verify a list of raw references, preserving order and removing duplicates.
 */
export function verifyClauseIds(
  rawIds: readonly string[],
  known: ReadonlySet<string>,
): { kept: string[]; discarded: string[] } {
  const kept: string[] = [];
  const discarded: string[] = [];
  const seen = new Set<string>();

  for (const raw of rawIds) {
    const canonical = canonicaliseClauseId(raw, known);
    if (canonical === null) {
      discarded.push(typeof raw === "string" ? raw : String(raw));
      continue;
    }
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    kept.push(canonical);
  }

  return { kept, discarded };
}

export type VerificationOutcome<T> = {
  resolved: Resolved<T>[];
  report: CitationReport;
};

/**
 * Run every item through the gate. Items that end up with no real citation
 * are dropped rather than rendered unsupported.
 */
export function verifyItems<T>(
  items: readonly T[],
  getRawClauseIds: (item: T) => readonly string[],
  known: ReadonlySet<string>,
): VerificationOutcome<T> {
  const resolved: Resolved<T>[] = [];
  const invented = new Set<string>();
  let verifiedCount = 0;
  let discardedCount = 0;
  let droppedItemCount = 0;

  for (const item of items) {
    const { kept, discarded } = verifyClauseIds(getRawClauseIds(item), known);

    discardedCount += discarded.length;
    for (const id of discarded) invented.add(id);

    if (kept.length === 0) {
      droppedItemCount += 1;
      continue;
    }

    verifiedCount += kept.length;
    resolved.push({ value: item, clauseIds: kept });
  }

  return {
    resolved,
    report: {
      verifiedCount,
      discardedCount,
      droppedItemCount,
      inventedIds: [...invented].slice(0, MAX_REPORTED_INVENTED_IDS),
    },
  };
}
