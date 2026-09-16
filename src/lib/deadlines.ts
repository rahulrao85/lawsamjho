/**
 * Deadline arithmetic.
 *
 * The model's job ends at reporting *what the document says* — "six (6) months
 * from the commencement date". Turning that into an actual calendar date is
 * plain arithmetic, so it happens here, in pure functions, and never in the
 * model. A model asked to compute "6 months after 01-Apr-2026" will get it right
 * most of the time, and the one time it is wrong it will be wrong confidently,
 * on a date the user might rely on. That trade is not worth taking.
 *
 * Everything is UTC. Not because deadlines are timezone-sensitive, but because
 * the same inputs must give the same answer on the server, in the browser, and
 * in a test run on a machine set to any locale. `new Date(2026, 3, 1)` does not.
 */

export type DeadlineUnit = "days" | "weeks" | "months" | "years";
export type DeadlineDirection = "after" | "before";

/**
 * What the deadline is measured from.
 * - `anchor`: the date the user supplied (usually the agreement date) — computable.
 * - `event`: something that has not happened yet (vacating, a default, giving
 *   notice) — not computable from an anchor date, and pretending otherwise
 *   would be a lie.
 * - `recurring`: it repeats (rent by the 7th of every month). Arithmetically
 *   there is no single date, so no date is produced — but it must not be
 *   described the same way as an event, or the user is told the wrong reason.
 * - `none`: the clause states no deadline.
 */
export type DeadlineBasis = "anchor" | "event" | "recurring" | "none";

export type DeadlineSpec = {
  /** The deadline in the document's own words. Empty when none is stated. */
  quotedText: string;
  amount: number | null;
  unit: DeadlineUnit | null;
  direction: DeadlineDirection | null;
  basis: DeadlineBasis;
  /**
   * Whether `quotedText` was actually found in the clause it cites. A date is
   * never computed from an unverified quote -- that is the one failure mode
   * that would produce a confident, wrong, actionable date.
   */
  quoteVerified: boolean;
};

export type ComputedDeadline = {
  /** Machine-readable, sortable, timezone-free. */
  iso: string;
  /** What a human reads: 28-Aug-2026. */
  display: string;
};

/** Well past any realistic contract term; catches a garbled "amount". */
const MAX_AMOUNT = 1200;

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year: number, monthIndex: number): number {
  // Day 0 of the next month is the last day of this one.
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** Strict: the shape must be right *and* the date must exist (not 31-Feb). */
export function parseIsoDate(value: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month - 1)) return null;

  return { year, month, day };
}

export function isValidIsoDate(value: string): boolean {
  return parseIsoDate(value) !== null;
}

export function toIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** DD-Mon-YYYY, built from a fixed table rather than a locale. */
export function formatDisplayDate(iso: string): string {
  const parts = parseIsoDate(iso);
  if (!parts) return iso;
  return `${String(parts.day).padStart(2, "0")}-${MONTH_NAMES[parts.month - 1]}-${parts.year}`;
}

/** Today, in the user's own timezone, as the date they would write down. */
export function todayIsoDate(now: Date = new Date()): string {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Shift a date by an offset.
 *
 * Months and years clamp to the end of the target month: 31-Jan plus one month
 * is 28-Feb, not 2-Mar. `Date.UTC(y, m, d)` silently overflows, which would put
 * a notice deadline three days late, so the day is clamped explicitly.
 */
export function addOffset(
  iso: string,
  amount: number,
  unit: DeadlineUnit,
  direction: DeadlineDirection,
): string | null {
  const parts = parseIsoDate(iso);
  if (!parts) return null;
  if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) return null;

  const sign = direction === "after" ? 1 : -1;
  const delta = sign * amount;

  if (unit === "days" || unit === "weeks") {
    const days = unit === "weeks" ? delta * 7 : delta;
    const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
    return toIsoDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
  }

  const monthsToAdd = unit === "years" ? delta * 12 : delta;
  // Work in absolute months so negative offsets across year boundaries behave.
  const totalMonths = (parts.year * 12 + (parts.month - 1)) + monthsToAdd;
  const year = Math.floor(totalMonths / 12);
  const monthIndex = totalMonths - year * 12;
  const day = Math.min(parts.day, daysInMonth(year, monthIndex));

  return toIsoDate(year, monthIndex + 1, day);
}

/**
 * The whole point: turn a stated offset into a real date, or refuse.
 *
 * Returns null when there is nothing trustworthy to compute from -- no stated
 * deadline, a deadline anchored to a future event rather than to the anchor
 * date, or a quote that could not be found in the clause it cites.
 */
export function computeDeadline(
  anchorIso: string,
  spec: DeadlineSpec,
): ComputedDeadline | null {
  if (!spec.quoteVerified) return null;
  if (spec.basis !== "anchor") return null;
  if (spec.amount === null || spec.unit === null || spec.direction === null) return null;

  const iso = addOffset(anchorIso, spec.amount, spec.unit, spec.direction);
  if (iso === null) return null;

  return { iso, display: formatDisplayDate(iso) };
}

/** "6 months after" -> a human phrase used in the obligation list. */
export function describeOffset(spec: DeadlineSpec): string | null {
  if (spec.amount === null || spec.unit === null || spec.direction === null) return null;
  const unit = spec.amount === 1 ? spec.unit.replace(/s$/, "") : spec.unit;
  return `${spec.amount} ${unit} ${spec.direction}`;
}
