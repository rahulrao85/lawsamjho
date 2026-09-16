import { describe, expect, it } from "vitest";
import { isVerifiedQuote, normaliseForComparison, verifyQuote } from "@/lib/summary/quote";

const LOCK_IN =
  "The Licensee shall not terminate this agreement before the expiry of six (6) months from the commencement date.";

describe("normaliseForComparison", () => {
  it("lowercases and strips punctuation", () => {
    expect(normaliseForComparison("Six (6) Months, from the Commencement date.")).toBe(
      "six 6 months from the commencement date",
    );
  });

  it("treats curly and straight apostrophes identically", () => {
    // Both sides of a comparison must normalise the same way, or a quote from a
    // PDF (which uses real typographic apostrophes) would never match.
    expect(normaliseForComparison("\u2018the Licensor\u2019s\u201d")).toBe("the licensor s");
    expect(normaliseForComparison("'the Licensor's\"")).toBe("the licensor s");
  });

  it("collapses whitespace and newlines", () => {
    expect(normaliseForComparison("  a\n\n  b \t c ")).toBe("a b c");
  });
});

describe("verifyQuote", () => {
  it("accepts a verbatim snippet", () => {
    expect(verifyQuote("six (6) months from the commencement date", LOCK_IN)).toEqual({
      status: "exact",
    });
    expect(isVerifiedQuote(verifyQuote("six (6) months from the commencement date", LOCK_IN))).toBe(true);
  });

  it("accepts the ways a model actually quotes", () => {
    // Verbatim.
    expect(verifyQuote("six (6) months", LOCK_IN).status).toBe("exact");
    // Case-changed, which normalisation erases entirely.
    expect(verifyQuote("FROM THE COMMENCEMENT DATE", LOCK_IN).status).toBe("exact");
    // Parenthetical number dropped: the words are all there, in order, but no
    // longer contiguous -- exactly what "in-order" is for.
    expect(verifyQuote("six months from the commencement date", LOCK_IN).status).toBe("in-order");
    // ...and the same is true of the shorter form on its own.
    expect(verifyQuote("SIX MONTHS", LOCK_IN).status).toBe("in-order");
  });

  it("accepts a quote whose words are in the clause but split by other words", () => {
    // "before the expiry of six (6) months" -> "before the expiry of ... six ... months"
    expect(verifyQuote("before six months", LOCK_IN).status).toBe("in-order");
  });

  it("rejects a quote that is not in the clause at all", () => {
    expect(verifyQuote("within 30 days of the default", LOCK_IN)).toEqual({ status: "not-found" });
    expect(isVerifiedQuote(verifyQuote("within 30 days of the default", LOCK_IN))).toBe(false);
  });

  it("rejects a quote whose words are present but out of order", () => {
    // Every word appears in the clause, but not in this sequence.
    expect(verifyQuote("months six the of expiry", LOCK_IN).status).toBe("not-found");
  });

  it("reports an empty quote distinctly, since 'no deadline stated' is legitimate", () => {
    expect(verifyQuote("", LOCK_IN)).toEqual({ status: "empty" });
    expect(verifyQuote("   ", LOCK_IN)).toEqual({ status: "empty" });
    expect(verifyQuote("...", LOCK_IN)).toEqual({ status: "empty" });
  });

  it("refuses to 'verify' something too short to be evidence", () => {
    expect(verifyQuote("the", LOCK_IN).status).toBe("not-found");
    expect(verifyQuote("a", LOCK_IN).status).toBe("not-found");
  });

  it("returns not-found rather than throwing when the clause text is empty", () => {
    expect(verifyQuote("six months", "")).toEqual({ status: "not-found" });
  });

  it("does not match across a clause boundary", () => {
    // The words exist, but in two different clauses -- a quote spanning them
    // is a fabricated quotation.
    expect(verifyQuote("commencement date governed by Indian law", LOCK_IN).status).toBe("not-found");
  });
});
