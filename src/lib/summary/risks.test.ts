import { describe, expect, it } from "vitest";
import { computeDeadline } from "@/lib/deadlines";
import { segmentClauses } from "@/lib/segment";
import {
  analyseRisksAndObligations,
  countBySeverity,
  normaliseAmount,
  normaliseBasis,
  normaliseKeyDate,
  normaliseObligation,
  normaliseRisk,
  normaliseSeverity,
  type ObligationInput,
  type RiskInput,
} from "@/lib/summary/risks";

const DOCUMENT = [
  "This Rent Agreement is made between the Licensor and the Licensee.",
  "1. The licence shall be for eleven (11) months commencing on 01-Apr-2026.",
  "2. The Licensee shall pay the security deposit, refunded within ninety (90) days of the Licensee vacating the Premises.",
  "3. Any dispute shall be referred to the sole arbitration of an arbitrator appointed by the Licensor.",
  "4. The Licensee shall keep the Premises in good repair.",
  "5. The Licensee shall pay the monthly rent on or before the seventh day of each calendar month.",
].join("\n");

const { clauses } = segmentClauses(DOCUMENT);
const KNOWN = new Set(clauses.map((clause) => clause.id));

function makeObligation(overrides: Partial<ObligationInput> = {}): ObligationInput {
  return {
    description: "The Licensee must pay the monthly rent in advance.",
    party: "Licensee",
    clauseIds: ["CLAUSE-02"],
    deadlineQuotedText: "within ninety (90) days of the Licensee vacating",
    deadlineAmount: "90",
    deadlineUnit: "days",
    deadlineDirection: "after",
    deadlineBasis: "anchor",
    ...overrides,
  };
}

describe("normaliseSeverity", () => {
  it("accepts the four levels in any casing or spacing", () => {
    expect(normaliseSeverity("Critical")).toBe("critical");
    expect(normaliseSeverity("HIGH")).toBe("high");
    expect(normaliseSeverity(" medium ")).toBe("medium");
    expect(normaliseSeverity("Low")).toBe("low");
  });

  it("maps common synonyms onto the four levels", () => {
    expect(normaliseSeverity("severe")).toBe("critical");
    expect(normaliseSeverity("moderate")).toBe("medium");
    expect(normaliseSeverity("minor")).toBe("low");
  });

  it("returns null for anything it does not recognise", () => {
    expect(normaliseSeverity("spicy")).toBeNull();
    expect(normaliseSeverity("")).toBeNull();
    expect(normaliseSeverity(undefined)).toBeNull();
    expect(normaliseSeverity(3)).toBeNull();
  });
});

describe("normaliseAmount", () => {
  it("reads digits, including the digits inside a parenthetical", () => {
    expect(normaliseAmount("6")).toBe(6);
    expect(normaliseAmount("six (6)")).toBe(6);
    expect(normaliseAmount("90 days")).toBe(90);
  });

  it("reads number words", () => {
    expect(normaliseAmount("six")).toBe(6);
    expect(normaliseAmount("eleven")).toBe(11);
    expect(normaliseAmount("ninety")).toBe(90);
  });

  it("returns null when there is no amount to read", () => {
    expect(normaliseAmount("as soon as possible")).toBeNull();
    expect(normaliseAmount("")).toBeNull();
    expect(normaliseAmount(undefined)).toBeNull();
    expect(normaliseAmount("0")).toBeNull();
  });
});

describe("normaliseBasis", () => {
  it("recognises the anchor-relative basis", () => {
    for (const value of ["anchor", "agreement date", "commencement", "start date", "execution date", "today"]) {
      expect(normaliseBasis(value, false), value).toBe("anchor");
    }
  });

  it("recognises an event-relative basis", () => {
    expect(normaliseBasis("event", false)).toBe("event");
    expect(normaliseBasis("vacating", false)).toBe("event");
    expect(normaliseBasis("default", false)).toBe("event");
  });

  it("recognises a recurring basis, distinctly from an event", () => {
    // Both produce no date, but for different reasons -- and the UI must be
    // able to say "this repeats" rather than "this hasn't happened yet".
    expect(normaliseBasis("recurring", false)).toBe("recurring");
    expect(normaliseBasis("monthly", false)).toBe("recurring");
    expect(normaliseBasis("each calendar month", false)).toBe("recurring");
    expect(normaliseBasis("quarterly", false)).toBe("recurring");
  });

  it("reports none when the clause states no deadline", () => {
    expect(normaliseBasis("none", false)).toBe("none");
    expect(normaliseBasis("", false)).toBe("none");
    expect(normaliseBasis("", true)).toBe("none");
  });

  it("never falls back to anchor for an unrecognised value", () => {
    // The only dangerous default: `anchor` is the basis that produces a date.
    expect(normaliseBasis("whenever the parties agree", false)).toBe("none");
    expect(normaliseBasis("banana", false)).toBe("none");
  });
});

describe("normaliseRisk", () => {
  const good: RiskInput = {
    title: "Arbitrator chosen by the Licensor",
    explanation: "The Licensor picks the arbitrator, and their decision is final.",
    severity: "high",
    clauseIds: ["CLAUSE-03"],
  };

  it("accepts a well-formed risk", () => {
    expect(normaliseRisk(good, KNOWN)).toEqual({
      title: "Arbitrator chosen by the Licensor",
      explanation: "The Licensor picks the arbitrator, and their decision is final.",
      severity: "high",
      clauseIds: ["CLAUSE-03"],
    });
  });

  it("drops a risk whose severity it cannot place", () => {
    expect(normaliseRisk({ ...good, severity: "quite bad" }, KNOWN)).toBeNull();
  });

  it("drops a risk that cites no real clause", () => {
    expect(normaliseRisk({ ...good, clauseIds: ["CLAUSE-99"] }, KNOWN)).toBeNull();
    expect(normaliseRisk({ ...good, clauseIds: [] }, KNOWN)).toBeNull();
    expect(normaliseRisk({ ...good, clauseIds: undefined }, KNOWN)).toBeNull();
  });

  it("keeps a risk when only some of its citations are real", () => {
    const risk = normaliseRisk({ ...good, clauseIds: ["CLAUSE-99", "clause 3"] }, KNOWN);
    expect(risk?.clauseIds).toEqual(["CLAUSE-03"]);
  });

  it("drops a risk with no substance", () => {
    expect(normaliseRisk({ ...good, title: "x" }, KNOWN)).toBeNull();
    expect(normaliseRisk({ ...good, explanation: "bad." }, KNOWN)).toBeNull();
  });

  it("survives junk where a field should be", () => {
    expect(normaliseRisk({ ...good, clauseIds: "CLAUSE-03" }, KNOWN)).toBeNull();
    expect(normaliseRisk({ ...good, title: 42 }, KNOWN)).toBeNull();
  });
});

describe("normaliseObligation", () => {
  it("accepts an obligation whose deadline quote is really in the clause", () => {
    const { obligation, unverifiedQuote } = normaliseObligation(makeObligation(), KNOWN, clauses);
    expect(unverifiedQuote).toBe(false);
    expect(obligation?.deadlineUnverified).toBe(false);
    expect(obligation?.deadline).toEqual({
      quotedText: "within ninety (90) days of the Licensee vacating",
      amount: 90,
      unit: "days",
      direction: "after",
      basis: "anchor",
      quoteVerified: true,
    });
  });

  it("refuses to verify a quote it cannot find, and counts it", () => {
    const { obligation, unverifiedQuote } = normaliseObligation(
      makeObligation({ deadlineQuotedText: "within 30 days of signing" }),
      KNOWN,
      clauses,
    );
    expect(unverifiedQuote).toBe(true);
    expect(obligation?.deadlineUnverified).toBe(true);
    expect(obligation?.deadline.quoteVerified).toBe(false);
    expect(obligation?.deadline.quotedText).toBe("");
    // The obligation survives -- only the unverifiable deadline is discarded.
    expect(obligation?.description).toContain("monthly rent");
  });

  it("distinguishes an absent deadline from an unverifiable one", () => {
    // These two must not be conflated: one means the document is silent, the
    // other means the model may have invented a deadline.
    const absent = normaliseObligation(
      makeObligation({
        clauseIds: ["CLAUSE-04"],
        deadlineQuotedText: "",
        deadlineBasis: "none",
        deadlineAmount: "",
        deadlineUnit: "",
        deadlineDirection: "",
      }),
      KNOWN,
      clauses,
    );
    expect(absent.unverifiedQuote).toBe(false);
    expect(absent.obligation?.deadlineUnverified).toBe(false);
    expect(absent.obligation?.deadline.basis).toBe("none");
    expect(absent.obligation?.deadline.quoteVerified).toBe(false);

    const unverifiable = normaliseObligation(
      makeObligation({ deadlineQuotedText: "within three months of signing" }),
      KNOWN,
      clauses,
    );
    expect(unverifiable.unverifiedQuote).toBe(true);
    expect(unverifiable.obligation?.deadlineUnverified).toBe(true);
  });

  it("drops an obligation that cites no real clause", () => {
    const { obligation } = normaliseObligation(makeObligation({ clauseIds: ["CLAUSE-77"] }), KNOWN, clauses);
    expect(obligation).toBeNull();
  });

  it("normalises the model's looser wording of the offset", () => {
    const { obligation } = normaliseObligation(
      makeObligation({
        clauseIds: ["CLAUSE-01"],
        deadlineQuotedText: "eleven (11) months commencing on",
        deadlineAmount: "eleven (11)",
        deadlineUnit: "Months",
        deadlineDirection: "from",
        deadlineBasis: "commencement date",
      }),
      KNOWN,
      clauses,
    );
    expect(obligation?.deadline).toMatchObject({
      amount: 11,
      unit: "months",
      direction: "after",
      basis: "anchor",
      quoteVerified: true,
    });
  });

  it("fills in a party rather than leaving it blank", () => {
    const { obligation } = normaliseObligation(makeObligation({ party: "  " }), KNOWN, clauses);
    expect(obligation?.party).toBe("Not specified");
  });

  it("drops an obligation with no description", () => {
    const { obligation } = normaliseObligation(makeObligation({ description: "pay" }), KNOWN, clauses);
    expect(obligation).toBeNull();
  });
});

describe("normaliseKeyDate", () => {
  it("accepts a key date whose quote is in the clause", () => {
    const { keyDate, unverifiedQuote } = normaliseKeyDate(
      {
        label: "End of the licence term",
        clauseIds: ["CLAUSE-01"],
        deadlineQuotedText: "eleven (11) months commencing on",
        deadlineAmount: "11",
        deadlineUnit: "months",
        deadlineDirection: "after",
        deadlineBasis: "anchor",
      },
      KNOWN,
      clauses,
    );

    expect(unverifiedQuote).toBe(false);
    expect(keyDate?.label).toBe("End of the licence term");
    expect(keyDate?.deadline).toMatchObject({
      amount: 11,
      unit: "months",
      direction: "after",
      basis: "anchor",
      quoteVerified: true,
    });
  });

  it("computes the term end from an anchor date", () => {
    const { keyDate } = normaliseKeyDate(
      {
        label: "End of term",
        clauseIds: ["CLAUSE-01"],
        deadlineQuotedText: "eleven (11) months",
        deadlineAmount: "11",
        deadlineUnit: "months",
        deadlineDirection: "after",
        deadlineBasis: "anchor",
      },
      KNOWN,
      clauses,
    );
    expect(computeDeadline("2026-04-01", keyDate!.deadline)).toEqual({
      iso: "2027-03-01",
      display: "01-Mar-2027",
    });
  });

  it("drops a key date that states no deadline, since it is then not a date", () => {
    const { keyDate } = normaliseKeyDate(
      {
        label: "Something vague",
        clauseIds: ["CLAUSE-04"],
        deadlineQuotedText: "",
        deadlineAmount: "",
        deadlineUnit: "",
        deadlineDirection: "",
        deadlineBasis: "none",
      },
      KNOWN,
      clauses,
    );
    expect(keyDate).toBeNull();
  });

  it("drops a key date whose quote it cannot find, and counts it", () => {
    const { keyDate, unverifiedQuote } = normaliseKeyDate(
      {
        label: "A fabricated date",
        clauseIds: ["CLAUSE-01"],
        deadlineQuotedText: "expiring on 31-Dec-2030",
        deadlineAmount: "5",
        deadlineUnit: "years",
        deadlineDirection: "after",
        deadlineBasis: "anchor",
      },
      KNOWN,
      clauses,
    );
    // A key date IS its date, so with an unverifiable quote there is nothing
    // left worth showing -- dropped rather than rendered half-empty.
    expect(keyDate).toBeNull();
    expect(unverifiedQuote).toBe(true);
  });

  it("drops a key date citing no real clause, or with no label", () => {
    const base = {
      label: "End of term",
      clauseIds: ["CLAUSE-01"],
      deadlineQuotedText: "eleven (11) months",
      deadlineAmount: "11",
      deadlineUnit: "months",
      deadlineDirection: "after",
      deadlineBasis: "anchor",
    };
    expect(normaliseKeyDate({ ...base, clauseIds: ["CLAUSE-88"] }, KNOWN, clauses).keyDate).toBeNull();
    expect(normaliseKeyDate({ ...base, label: "x" }, KNOWN, clauses).keyDate).toBeNull();
  });
});

describe("recurring deadlines", () => {
  it("keeps the obligation, records the quote, and computes no date", () => {
    // Rent payable by the 7th of every month: real, correctly quoted, but there
    // is no single date to calculate.
    const { obligation } = normaliseObligation(
      makeObligation({
        clauseIds: ["CLAUSE-05"],
        deadlineQuotedText: "on or before the seventh day of each calendar month",
        deadlineAmount: "7",
        deadlineUnit: "days",
        deadlineDirection: "before",
        deadlineBasis: "recurring",
      }),
      KNOWN,
      clauses,
    );

    expect(obligation?.deadline.basis).toBe("recurring");
    expect(obligation?.deadline.quoteVerified).toBe(true);
    expect(obligation?.deadline.quotedText).toBe(
      "on or before the seventh day of each calendar month",
    );
    expect(computeDeadline("2026-04-01", obligation!.deadline)).toBeNull();
  });
});

describe("analyseRisksAndObligations", () => {
  it("keeps the good items, drops the bad ones and reports both", () => {
    const analysis = analyseRisksAndObligations(
      [
        {
          title: "Arbitrator picked by one side",
          explanation: "The Licensor appoints the arbitrator and the decision is binding.",
          severity: "high",
          clauseIds: ["CLAUSE-03"],
        },
        { title: "Nonsense", explanation: "This cites a clause that does not exist.", severity: "low", clauseIds: ["CLAUSE-99"] },
        { title: "Also nonsense", explanation: "This has no usable severity at all.", severity: "very bad", clauseIds: ["CLAUSE-01"] },
      ],
      [
        makeObligation(),
        makeObligation({ description: "An obligation citing nothing real at all.", clauseIds: ["CLAUSE-42"] }),
      ],
      clauses,
    );

    expect(analysis.risks).toHaveLength(1);
    expect(analysis.report.risksKept).toBe(1);
    expect(analysis.report.risksDropped).toBe(2);
    expect(analysis.obligations).toHaveLength(1);
    expect(analysis.report.obligationsKept).toBe(1);
    expect(analysis.report.obligationsDropped).toBe(1);
  });

  it("orders risks most serious first", () => {
    const analysis = analyseRisksAndObligations(
      [
        { title: "A low one", explanation: "Not very serious at all.", severity: "low", clauseIds: ["CLAUSE-01"] },
        { title: "A critical one", explanation: "Could lose possession immediately.", severity: "critical", clauseIds: ["CLAUSE-03"] },
        { title: "A medium one", explanation: "Somewhat serious matter.", severity: "medium", clauseIds: ["CLAUSE-04"] },
      ],
      [],
      clauses,
    );
    expect(analysis.risks.map((risk) => risk.severity)).toEqual(["critical", "medium", "low"]);
  });

  it("counts unverified deadline quotes separately from dropped obligations", () => {
    const analysis = analyseRisksAndObligations(
      [],
      [
        makeObligation({ deadlineQuotedText: "within 30 days of notice" }),
        makeObligation({ deadlineQuotedText: "within seven days" }),
      ],
      clauses,
    );
    expect(analysis.report.unverifiedDeadlineQuotes).toBe(2);
    expect(analysis.report.obligationsDropped).toBe(0);
    expect(analysis.report.obligationsKept).toBe(2);
  });

  it("handles an empty response without inventing anything", () => {
    const analysis = analyseRisksAndObligations([], [], clauses);
    expect(analysis.risks).toEqual([]);
    expect(analysis.obligations).toEqual([]);
    expect(analysis.keyDates).toEqual([]);
    expect(analysis.report).toEqual({
      risksKept: 0,
      risksDropped: 0,
      obligationsKept: 0,
      obligationsDropped: 0,
      keyDatesKept: 0,
      keyDatesDropped: 0,
      unverifiedDeadlineQuotes: 0,
    });
  });
});

describe("the whole Phase 2 chain, end to end", () => {
  it("goes from model output to a real computed date", () => {
    const analysis = analyseRisksAndObligations(
      [],
      [
        makeObligation({
          description: "The deposit must be refunded after the tenant vacates.",
          clauseIds: ["CLAUSE-02"],
          deadlineQuotedText: "within ninety (90) days of the Licensee vacating",
          deadlineAmount: "90",
          deadlineUnit: "days",
          deadlineDirection: "after",
          deadlineBasis: "anchor",
        }),
      ],
      clauses,
    );

    const deadline = analysis.obligations[0].deadline;
    expect(computeDeadline("2026-04-01", deadline)).toEqual({
      iso: "2026-06-30",
      display: "30-Jun-2026",
    });
  });

  it("produces no date when the model invented the deadline", () => {
    const analysis = analyseRisksAndObligations(
      [],
      [makeObligation({ deadlineQuotedText: "within 7 days of signing" })],
      clauses,
    );
    // The chain never reaches computeDeadline with a fabricated quote.
    expect(computeDeadline("2026-04-01", analysis.obligations[0].deadline)).toBeNull();
  });
});

describe("countBySeverity", () => {
  it("counts each level, including zeroes", () => {
    const analysis = analyseRisksAndObligations(
      [
        { title: "One", explanation: "First critical risk here.", severity: "critical", clauseIds: ["CLAUSE-01"] },
        { title: "Two", explanation: "Second critical risk here.", severity: "critical", clauseIds: ["CLAUSE-02"] },
        { title: "Three", explanation: "A single low risk here.", severity: "low", clauseIds: ["CLAUSE-03"] },
      ],
      [],
      clauses,
    );
    expect(countBySeverity(analysis.risks)).toEqual({ critical: 2, high: 0, medium: 0, low: 1 });
  });
});
