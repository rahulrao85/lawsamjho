import {
  type DeadlineBasis,
  type DeadlineDirection,
  type DeadlineSpec,
  type DeadlineUnit,
} from "@/lib/deadlines";
import { isVerifiedQuote, verifyQuote } from "@/lib/summary/quote";
import { verifyClauseIds } from "@/lib/summary/verify";
import type { Clause } from "@/lib/segment";

/**
 * Risks and obligations.
 *
 * Same pattern as Phase 1, extended rather than reinvented: model output goes
 * through the citation gate, and the obligations get a second gate on top --
 * the quoted deadline must actually appear in the clause it cites before any
 * date is computed from it.
 *
 * The one structural difference from the summary: these are *lists*, so a bad
 * item is dropped on its own and counted, instead of failing the whole
 * generation. One malformed risk should not cost the user their summary.
 *
 * Everything arriving from the model is treated as untrusted text of unknown
 * shape (`unknown`), normalised here, and either converted into a domain object
 * or rejected. Nothing is passed through on the assumption that it is probably
 * fine.
 */

export type RiskSeverity = "critical" | "high" | "medium" | "low";

export const SEVERITY_ORDER: Record<RiskSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const SEVERITY_LABEL: Record<RiskSeverity, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export type Risk = {
  title: string;
  explanation: string;
  severity: RiskSeverity;
  clauseIds: string[];
};

export type Obligation = {
  description: string;
  /** Who has to do it, as the document describes them ("the Licensee"). */
  party: string;
  clauseIds: string[];
  deadline: DeadlineSpec;
  /**
   * True when the model reported a deadline whose words could not be found in
   * the cited clause. This is *not* the same as "the clause sets no deadline",
   * and the two must not read the same on screen: one means the document is
   * silent, the other means the model may have invented something.
   */
  deadlineUnverified: boolean;
};

/**
 * A date the document fixes rather than a duty: the end of the term, the end of
 * a lock-in, when a notice window opens.
 *
 * Structurally identical to an obligation's deadline, and normalised through the
 * same function, so it inherits the same quote gate and the same arithmetic.
 * It exists because the end of the term is the single most useful date in a
 * lease and there is no obligation it naturally attaches to.
 *
 * Unlike an obligation, a key date whose quote cannot be found in its clause is
 * dropped outright rather than kept with a warning: an obligation still says
 * something useful without its deadline, whereas a key date *is* its date, so
 * there would be nothing left to show.
 */
export type KeyDate = {
  label: string;
  clauseIds: string[];
  deadline: DeadlineSpec;
};

export type AnalysisReport = {
  risksKept: number;
  risksDropped: number;
  obligationsKept: number;
  obligationsDropped: number;
  keyDatesKept: number;
  keyDatesDropped: number;
  /**
   * Deadlines whose stated words could not be found in the clause they cite.
   * Surfaced rather than hidden, because it is the signal that the model has
   * invented a deadline -- and the reason no date was computed for it.
   */
  unverifiedDeadlineQuotes: number;
};

export type Analysis = {
  risks: Risk[];
  obligations: Obligation[];
  keyDates: KeyDate[];
  report: AnalysisReport;
};

/* -------------------------------------------------------------------------- */
/* Normalisation of model vocabulary                                           */
/* -------------------------------------------------------------------------- */

const SEVERITY_SYNONYMS: Record<string, RiskSeverity> = {
  critical: "critical",
  severe: "critical",
  veryhigh: "critical",
  high: "high",
  serious: "high",
  medium: "medium",
  moderate: "medium",
  med: "medium",
  low: "low",
  minor: "low",
  informational: "low",
  info: "low",
};

const UNIT_SYNONYMS: Record<string, DeadlineUnit> = {
  day: "days",
  days: "days",
  daily: "days",
  week: "weeks",
  weeks: "weeks",
  weekly: "weeks",
  month: "months",
  months: "months",
  monthly: "months",
  year: "years",
  years: "years",
  yearly: "years",
  annual: "years",
  annually: "years",
};

const AFTER_WORDS = new Set(["after", "from", "within", "of", "onwards", "onward", "post", "following"]);
const BEFORE_WORDS = new Set(["before", "prior", "priorto", "inadvanceof", "aheadof", "preceding"]);

const ANCHOR_WORDS = new Set([
  "anchor",
  "agreement",
  "agreementdate",
  "commencement",
  "commencementdate",
  "start",
  "startdate",
  "execution",
  "executiondate",
  "signing",
  "signingdate",
  "effectivedate",
  "today",
  "leasecommencement",
]);

const EVENT_WORDS = new Set([
  "event",
  "custom",
  "trigger",
  "occurrence",
  "triggeringevent",
  "eventdate",
  "uponvacating",
  "vacating",
  "default",
  "notice",
]);

/**
 * Repeats rather than falling due once. Distinguished from `event` because the
 * two produce the same outcome (no computed date) for entirely different
 * reasons, and telling someone their rent is "an event that has not happened
 * yet" is simply wrong.
 *
 * Keys are lowercase alphanumeric only -- `key()` strips everything else -- so
 * "each calendar month" is written "eachcalendarmonth" here.
 */
const RECURRING_WORDS = new Set([
  "recurring",
  "recurringdate",
  "repeating",
  "periodic",
  "periodically",
  "monthly",
  "eachmonth",
  "everymonth",
  "permonth",
  "eachcalendarmonth",
  "quarterly",
  "quarter",
  "annually",
  "annual",
  "yearly",
  "weekly",
  "daily",
]);

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100,
};

/** Lowercase, strip everything that is not a letter or digit. */
function key(value: unknown): string {
  return typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function normaliseSeverity(value: unknown): RiskSeverity | null {
  return SEVERITY_SYNONYMS[key(value)] ?? null;
}

function normaliseUnit(value: unknown): DeadlineUnit | null {
  const normalised = key(value);
  if (normalised.length === 0 || normalised === "none" || normalised === "na") return null;
  return UNIT_SYNONYMS[normalised] ?? null;
}

function normaliseDirection(value: unknown): DeadlineDirection | null {
  const normalised = key(value);
  if (AFTER_WORDS.has(normalised)) return "after";
  if (BEFORE_WORDS.has(normalised)) return "before";
  return null;
}

/**
 * Unknown bases resolve to `none`, not to `anchor`.
 *
 * `anchor` is the only basis that produces a computed calendar date, so an
 * unrecognised value must never fall into it by default. Erring towards "we
 * could not work out a date" is the safe direction; the quoted text is still
 * shown either way.
 */
export function normaliseBasis(value: unknown, quoteIsEmpty: boolean): DeadlineBasis {
  if (quoteIsEmpty) return "none";
  const normalised = key(value);
  if (normalised.length === 0 || normalised === "none" || normalised === "notstated") return "none";
  if (ANCHOR_WORDS.has(normalised)) return "anchor";
  if (RECURRING_WORDS.has(normalised)) return "recurring";
  if (EVENT_WORDS.has(normalised)) return "event";
  return "none";
}

/** Accepts "6", "6 months", "six", "six (6)". */
export function normaliseAmount(value: unknown): number | null {
  const raw = text(value);
  if (raw.length === 0) return null;

  const digits = /\d{1,4}/.exec(raw);
  if (digits) {
    const parsed = Number(digits[0]);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }

  for (const word of raw.toLowerCase().split(/[^a-z]+/)) {
    const mapped = NUMBER_WORDS[word];
    if (mapped) return mapped;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* Gates                                                                       */
/* -------------------------------------------------------------------------- */

export type RiskInput = {
  title?: unknown;
  explanation?: unknown;
  severity?: unknown;
  clauseIds?: unknown;
};

export type ObligationInput = {
  description?: unknown;
  party?: unknown;
  clauseIds?: unknown;
  deadlineQuotedText?: unknown;
  deadlineAmount?: unknown;
  deadlineUnit?: unknown;
  deadlineDirection?: unknown;
  deadlineBasis?: unknown;
};

export type KeyDateInput = {
  label?: unknown;
  clauseIds?: unknown;
  deadlineQuotedText?: unknown;
  deadlineAmount?: unknown;
  deadlineUnit?: unknown;
  deadlineDirection?: unknown;
  deadlineBasis?: unknown;
};

/** The deadline half of both an obligation and a key date, gated identically. */
type DeadlineFields = {
  deadlineQuotedText?: unknown;
  deadlineAmount?: unknown;
  deadlineUnit?: unknown;
  deadlineDirection?: unknown;
  deadlineBasis?: unknown;
};

function normaliseDeadline(
  input: DeadlineFields,
  clauseIds: readonly string[],
  clauses: readonly Clause[],
): { deadline: DeadlineSpec; unverifiedQuote: boolean } {
  const quotedText = text(input.deadlineQuotedText);
  const verdict = verifyQuote(quotedText, textByClauseId(clauses, clauseIds));

  const blank: DeadlineSpec = {
    quotedText: "",
    amount: null,
    unit: null,
    direction: null,
    basis: "none",
    quoteVerified: false,
  };

  // No deadline claimed at all: the clause simply does not set one.
  if (verdict.status === "empty") return { deadline: blank, unverifiedQuote: false };

  // A deadline was claimed and could not be shown to exist. Keep nothing that
  // could be turned into a date, and count it so the UI can say why.
  if (!isVerifiedQuote(verdict)) return { deadline: blank, unverifiedQuote: true };

  return {
    deadline: {
      quotedText,
      amount: normaliseAmount(input.deadlineAmount),
      unit: normaliseUnit(input.deadlineUnit),
      direction: normaliseDirection(input.deadlineDirection),
      basis: normaliseBasis(input.deadlineBasis, false),
      quoteVerified: true,
    },
    unverifiedQuote: false,
  };
}

function clauseIdsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function textByClauseId(clauses: readonly Clause[], ids: readonly string[]): string {
  const index = new Map(clauses.map((clause) => [clause.id, clause.text]));
  return ids.map((id) => index.get(id) ?? "").join(" ");
}

export function normaliseRisk(
  input: RiskInput,
  known: ReadonlySet<string>,
): Risk | null {
  const title = text(input.title);
  const explanation = text(input.explanation);
  if (title.length < 3 || explanation.length < 10) return null;

  const severity = normaliseSeverity(input.severity);
  // Severity is the feature. A risk without a recognised one is not a risk the
  // user can act on, so it is dropped and counted rather than guessed at.
  if (severity === null) return null;

  const { kept } = verifyClauseIds(clauseIdsOf(input.clauseIds), known);
  if (kept.length === 0) return null;

  return { title, explanation, severity, clauseIds: kept };
}

export function normaliseObligation(
  input: ObligationInput,
  known: ReadonlySet<string>,
  clauses: readonly Clause[],
): { obligation: Obligation | null; unverifiedQuote: boolean } {
  const description = text(input.description);
  if (description.length < 10) return { obligation: null, unverifiedQuote: false };

  const { kept } = verifyClauseIds(clauseIdsOf(input.clauseIds), known);
  if (kept.length === 0) return { obligation: null, unverifiedQuote: false };

  const { deadline, unverifiedQuote } = normaliseDeadline(input, kept, clauses);

  return {
    obligation: {
      description,
      party: text(input.party) || "Not specified",
      clauseIds: kept,
      deadline,
      deadlineUnverified: unverifiedQuote,
    },
    unverifiedQuote,
  };
}

export function normaliseKeyDate(
  input: KeyDateInput,
  known: ReadonlySet<string>,
  clauses: readonly Clause[],
): { keyDate: KeyDate | null; unverifiedQuote: boolean } {
  const label = text(input.label);
  if (label.length < 3) return { keyDate: null, unverifiedQuote: false };

  const { kept } = verifyClauseIds(clauseIdsOf(input.clauseIds), known);
  if (kept.length === 0) return { keyDate: null, unverifiedQuote: false };

  const { deadline, unverifiedQuote } = normaliseDeadline(input, kept, clauses);

  // A key date with no usable deadline is not a date. That covers both "the
  // clause states none" and "the model claimed one we could not find"; the
  // latter is counted in the report so it is not silent.
  if (deadline.quotedText === "") {
    return { keyDate: null, unverifiedQuote };
  }

  return {
    keyDate: { label, clauseIds: kept, deadline },
    unverifiedQuote,
  };
}

export function analyseRisksAndObligations(
  rawRisks: readonly RiskInput[],
  rawObligations: readonly ObligationInput[],
  clauses: readonly Clause[],
  rawKeyDates: readonly KeyDateInput[] = [],
): Analysis {
  const known = new Set(clauses.map((clause) => clause.id));

  const risks: Risk[] = [];
  let risksDropped = 0;
  for (const raw of rawRisks) {
    const risk = normaliseRisk(raw, known);
    if (risk === null) risksDropped += 1;
    else risks.push(risk);
  }

  let unverifiedDeadlineQuotes = 0;

  const obligations: Obligation[] = [];
  let obligationsDropped = 0;
  for (const raw of rawObligations) {
    const { obligation, unverifiedQuote } = normaliseObligation(raw, known, clauses);
    if (unverifiedQuote) unverifiedDeadlineQuotes += 1;
    if (obligation === null) obligationsDropped += 1;
    else obligations.push(obligation);
  }

  const keyDates: KeyDate[] = [];
  let keyDatesDropped = 0;
  for (const raw of rawKeyDates) {
    const { keyDate, unverifiedQuote } = normaliseKeyDate(raw, known, clauses);
    if (unverifiedQuote) unverifiedDeadlineQuotes += 1;
    if (keyDate === null) keyDatesDropped += 1;
    else keyDates.push(keyDate);
  }

  // Most serious first: the whole point of a severity is to set reading order.
  risks.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

  return {
    risks,
    obligations,
    keyDates,
    report: {
      risksKept: risks.length,
      risksDropped,
      obligationsKept: obligations.length,
      obligationsDropped,
      keyDatesKept: keyDates.length,
      keyDatesDropped,
      unverifiedDeadlineQuotes,
    },
  };
}

/** Counts per severity, for the summary strip in the UI. */
export function countBySeverity(risks: readonly Risk[]): Record<RiskSeverity, number> {
  const counts: Record<RiskSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const risk of risks) counts[risk.severity] += 1;
  return counts;
}
