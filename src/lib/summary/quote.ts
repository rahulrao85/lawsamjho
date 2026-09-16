/**
 * Quote verification.
 *
 * Phase 1's gate checks that a *clause ID* the model cited exists. This one
 * checks something subtler and, for deadlines, more important: that the words
 * the model says it lifted from a clause are actually in that clause.
 *
 * It exists because of one specific failure. An obligation's deadline is
 * converted into a real calendar date, so if the model invents "within 30 days"
 * for a clause that says no such thing, the user gets a confident, wrong,
 * actionable date. Verifying the quote first means the arithmetic only ever runs
 * on words the document really contains.
 *
 * Matching has to tolerate how models quote. They lowercase, drop parenthetical
 * numbers ("six (6) months" -> "six months"), swap curly quotes, and collapse
 * whitespace. So: normalise hard, look for an exact substring first, and if that
 * fails require the quote's words to appear in the clause *in order* — which
 * still rejects a quote that was reassembled or invented.
 */

export type QuoteVerdict =
  | { status: "empty" }
  | { status: "exact" }
  | { status: "in-order" }
  | { status: "not-found" };

export function isVerifiedQuote(verdict: QuoteVerdict): boolean {
  return verdict.status === "exact" || verdict.status === "in-order";
}

/** Below this, "verification" would be meaningless -- any word matches anything. */
const MIN_VERIFIABLE_LENGTH = 4;

export function normaliseForComparison(value: string): string {
  return value
    .toLowerCase()
    // Apostrophes and punctuation both become separators, so "Licensor's" and
    // "licensors" normalise the same way on both sides of the comparison.
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Are every one of `needle`'s words present in `haystack`, in order? */
function isOrderedSubsequence(needle: string[], haystack: string[]): boolean {
  let cursor = 0;
  for (const word of haystack) {
    if (word === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return needle.length === 0;
}

export function verifyQuote(quote: string, clauseText: string): QuoteVerdict {
  const normalisedQuote = normaliseForComparison(quote);
  const normalisedClause = normaliseForComparison(clauseText);

  if (normalisedQuote.length === 0) return { status: "empty" };
  if (normalisedClause.length === 0) return { status: "not-found" };

  // Too short to be evidence of anything.
  if (normalisedQuote.length < MIN_VERIFIABLE_LENGTH) return { status: "not-found" };

  if (normalisedClause.includes(normalisedQuote)) return { status: "exact" };

  const quoteWords = normalisedQuote.split(" ");
  const clauseWords = normalisedClause.split(" ");

  return isOrderedSubsequence(quoteWords, clauseWords)
    ? { status: "in-order" }
    : { status: "not-found" };
}
