/**
 * Deterministic clause segmentation.
 *
 * This runs *before* any model call and is the single source of truth for what
 * a "clause ID" means. Everything downstream -- the summary, the risk flags,
 * the Q&A answers -- cites these IDs, and the citation gate throws away any ID
 * the model returns that is not present in the output of this file.
 *
 * Pure, synchronous, no I/O: it can be tested exhaustively, and it cannot
 * disagree with itself between calls (no Date.now, no random, no locale
 * dependence).
 *
 * Real PDFs are messy. Extraction gives hard-wrapped lines, page numbers
 * stranded on their own line, footnote numbers reordered into the body, and
 * measurements like "836.1 Sq. Meters" that look exactly like numbered
 * clauses. The guard rules below exist because of specific strings observed in
 * a real 36-page property agreement -- see `segment.test.ts`.
 */

export const CLAUSE_ID_PREFIX = "CLAUSE";

/**
 * The unnumbered opening of a document: parties, property, recitals. It is
 * citable, so it gets a stable id -- but it deliberately does not consume a
 * CLAUSE-nn slot, which keeps CLAUSE-03 pointing at the clause the document
 * itself calls "3" in the overwhelmingly common case.
 */
export const PREAMBLE_ID = "PREAMBLE";

export type ClauseKind = "preamble" | "numbered" | "paragraph" | "whole";

/** Stable, zero-padded, sortable: CLAUSE-01 … CLAUSE-99 … CLAUSE-100. */
export function clauseId(index: number): string {
  return `${CLAUSE_ID_PREFIX}-${String(index).padStart(2, "0")}`;
}

/** The 1-based index inside a CLAUSE-nn id, or null if it is not one. */
export function parseClauseId(value: string): number | null {
  const match = /^CLAUSE-(\d{1,4})$/.exec(value.trim().toUpperCase());
  if (!match) return null;
  const index = Number(match[1]);
  return index >= 1 ? index : null;
}

export function isPreambleId(value: string): boolean {
  return value.trim().toUpperCase() === PREAMBLE_ID;
}

export type Clause = {
  /** Stable citation handle. Never reused, never renumbered. */
  id: string;
  /** 1-based position for numbered clauses; 0 for the preamble. */
  index: number;
  /** The marker exactly as the document wrote it: "2.1", "Article 4", "¶3". */
  label: string;
  /** Clause body with the marker stripped and wrapped lines rejoined. */
  text: string;
  kind: ClauseKind;
};

export type SegmentationStrategy = "numbered" | "paragraphs" | "single";

export type SegmentationResult = {
  clauses: Clause[];
  strategy: SegmentationStrategy;
  warnings: string[];
};

/** Shortest unnumbered opening worth keeping as a citable preamble. */
const MIN_PREAMBLE_CHARS = 20;

type RawMarker = {
  number: string;
  rest: string;
  label: string;
  /** Characters consumed by the marker itself, so the body can be sliced out. */
  prefixLength: number;
};

/**
 * Marker forms treated as the start of a new clause, most specific first.
 * Each pattern must put the number in group 1 and the body in the last group.
 */
const MARKER_PATTERNS: {
  regex: RegExp;
  group: number;
  label: (match: RegExpExecArray) => string;
}[] = [
  {
    regex:
      /^(?:CLAUSE|Clause|ARTICLE|Article|SECTION|Section)\s+(\d+(?:\.\d+)*)\s*[:.)-]?\s*(\S.*)$/,
    group: 1,
    label: (match) => match[1],
  },
  {
    regex: /^(\d+(?:\.\d+){1,3})\s*[.):]?\s+(\S.*)$/,
    group: 1,
    label: (match) => match[1],
  },
  {
    regex: /^(\d{1,3})\s*[.)]\s*\(([a-z])\)\s*(\S.*)$/,
    group: 1,
    label: (match) => `${match[1]}.(${match[2]})`,
  },
  {
    regex: /^(\d{1,3})[.)]\s+(\S.*)$/,
    group: 1,
    label: (match) => match[1],
  },
];

/**
 * Words that, immediately after a number, mean it was a quantity and not a
 * clause marker. "836.1 Sq. Meters" and "12.50% share" are the real strings
 * that motivated this.
 */
const QUANTITY_FOLLOWERS =
  /^(%|sq\b|sq\.|meter|meters|metre|metres|m²|ft|feet|inch|kg|km|cm|mm|rs\b|rs\.|inr\b|₹|\/-|crore|lakh|per\b)/i;

/**
 * How far a top-level number may jump forward and still be believed.
 *
 * Real clause numbering restarts downwards (per section) and occasionally
 * skips, but it does not leap from 3 to 1908 -- which is exactly what a
 * footnote number reordered into the body does. The threshold is generous on
 * purpose: wrongly starting a clause is a cosmetic problem, whereas wrongly
 * *rejecting* one would hide a real obligation from the summary.
 */
const MAX_TOP_LEVEL_JUMP = 20;

function matchMarker(line: string): RawMarker | null {
  for (const { regex, group, label } of MARKER_PATTERNS) {
    const match = regex.exec(line);
    if (!match) continue;

    const number = match[group];
    const rest = match[match.length - 1];
    if (!rest || rest.trim().length < 2) return null;
    if (QUANTITY_FOLLOWERS.test(rest.trim())) return null;

    return {
      number,
      rest,
      label: label(match),
      // Everything before the body is the marker, including trailing spaces.
      prefixLength: match[0].length - rest.length,
    };
  }
  return null;
}

/** Top-level component of a dotted number: "2.1" -> 2. */
function topLevelOf(number: string): number {
  return Number(number.split(".")[0]);
}

function isBelievableJump(topLevel: number, previousTopLevel: number | null): boolean {
  if (!Number.isFinite(topLevel) || topLevel < 1) return false;
  if (previousTopLevel === null) return true;
  return topLevel <= previousTopLevel + MAX_TOP_LEVEL_JUMP;
}

/**
 * Rejoin hard-wrapped lines into flowing text.
 *
 * PDF extraction breaks lines mid-sentence. The one case worth special
 * handling: a line ending in a hyphen followed by a lowercase line is a
 * hyphenated word continuation ("indemnifi-\ncation"). A hyphen followed by a
 * capital is left alone, because it is more likely real.
 */
function joinWrappedLines(lines: string[]): string {
  let result = "";

  for (const line of lines) {
    if (!result) {
      result = line;
      continue;
    }

    const continuesWord = /[A-Za-z]-$/.test(result) && /^[a-z]/.test(line);
    result = continuesWord ? result.slice(0, -1) + line : `${result} ${line}`;
  }

  return result.replace(/\s+/g, " ").trim();
}

export function normaliseText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\f/g, "\n")
    .replace(/[\u200b-\u200d\ufeff]/g, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, all) => {
      // A bare number on its own line is a page number, never a clause body.
      if (/^\d{1,4}$/.test(line)) return false;
      // Collapse runs of blank lines down to one.
      if (line !== "") return true;
      return index > 0 && all[index - 1] !== "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildClause(
  index: number,
  label: string,
  kind: ClauseKind,
  bodyLines: string[],
): Clause {
  return {
    id: kind === "preamble" ? PREAMBLE_ID : clauseId(index),
    index,
    label,
    text: joinWrappedLines(bodyLines.filter((line) => line !== "")),
    kind,
  };
}

function segmentByMarkers(lines: string[]): SegmentationResult | null {
  const starts: { lineIndex: number; marker: RawMarker }[] = [];
  const rejected: string[] = [];
  let previousTopLevel: number | null = null;

  lines.forEach((line, lineIndex) => {
    const marker = matchMarker(line);
    if (!marker) return;

    if (!isBelievableJump(topLevelOf(marker.number), previousTopLevel)) {
      // Kept as body text rather than dropped: losing a line in a legal
      // document is worse than a stray fragment attached to a neighbour.
      rejected.push(line);
      return;
    }

    starts.push({ lineIndex, marker });
    previousTopLevel = topLevelOf(marker.number);
  });

  if (starts.length < 2) return null;

  const warnings: string[] = [];
  if (rejected.length > 0) {
    warnings.push(
      `${rejected.length} line(s) looked like numbered items but sat outside the document's numbering sequence, so they were not treated as clause starts. First: "${rejected[0].slice(0, 80)}"`,
    );
  }

  const clauses: Clause[] = [];

  const preambleText = joinWrappedLines(lines.slice(0, starts[0].lineIndex));
  if (preambleText.length >= MIN_PREAMBLE_CHARS) {
    clauses.push(buildClause(0, "Preamble", "preamble", [preambleText]));
  }

  starts.forEach((start, position) => {
    const bodyEnd = position + 1 < starts.length ? starts[position + 1].lineIndex : lines.length;
    const firstLine = lines[start.lineIndex];

    clauses.push(
      buildClause(position + 1, start.marker.label, "numbered", [
        firstLine.slice(start.marker.prefixLength),
        ...lines.slice(start.lineIndex + 1, bodyEnd),
      ]),
    );
  });

  const usable = clauses.filter((clause) => clause.text.length > 0);
  if (usable.filter((clause) => clause.kind === "numbered").length < 2) return null;

  // Re-number after filtering so IDs stay gapless and CLAUSE-nn always points
  // at array position n-1 among numbered clauses.
  let numbered = 0;
  return {
    clauses: usable.map((clause) => {
      if (clause.kind === "preamble") return clause;
      numbered += 1;
      return { ...clause, id: clauseId(numbered), index: numbered };
    }),
    strategy: "numbered",
    warnings,
  };
}

function segmentByParagraphs(blocks: string[]): SegmentationResult | null {
  const usable = blocks
    .map((block) => joinWrappedLines(block.split("\n")))
    .filter((text) => text.length > 0);

  if (usable.length < 2) return null;

  return {
    clauses: usable.map((text, position) => ({
      id: clauseId(position + 1),
      index: position + 1,
      label: `¶${position + 1}`,
      text,
      kind: "paragraph",
    })),
    strategy: "paragraphs",
    warnings: [
      "No numbered clause structure was found, so the document was split into paragraphs. Citations point at paragraphs, not clause numbers.",
    ],
  };
}

export function segmentClauses(rawText: string): SegmentationResult {
  const normalised = normaliseText(rawText);

  if (normalised.length === 0) {
    return {
      clauses: [],
      strategy: "single",
      warnings: ["The document contained no extractable text."],
    };
  }

  const byMarkers = segmentByMarkers(normalised.split("\n"));
  if (byMarkers) return byMarkers;

  const byParagraphs = segmentByParagraphs(normalised.split(/\n{2,}/));
  if (byParagraphs) return byParagraphs;

  return {
    clauses: [buildClause(1, "whole-document", "whole", [normalised])],
    strategy: "single",
    warnings: [
      "This document could not be split into clauses, so it is treated as one block. Every citation will point at the same ID, which makes them far less useful.",
    ],
  };
}

/** Convenience for the citation gate: the set of IDs that really exist. */
export function clauseIdSet(clauses: Clause[]): Set<string> {
  return new Set(clauses.map((clause) => clause.id));
}
