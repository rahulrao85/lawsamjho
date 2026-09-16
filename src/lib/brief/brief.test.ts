import { describe, expect, it } from "vitest";
import { briefToMarkdown, buildBrief, type BriefInput } from "@/lib/brief/brief";
import type { DeadlineSpec } from "@/lib/deadlines";
import type { Obligation, Risk } from "@/lib/summary/risks";

const ANCHOR = "2026-04-01";

function deadline(overrides: Partial<DeadlineSpec> = {}): DeadlineSpec {
  return {
    quotedText: "",
    amount: null,
    unit: null,
    direction: null,
    basis: "none",
    quoteVerified: false,
    ...overrides,
  };
}

const OBLIGATION: Obligation = {
  description: "Pay the monthly rent of Rs. 45,000.",
  party: "Licensee",
  clauseIds: ["CLAUSE-02"],
  deadline: deadline({
    quotedText: "on or before the seventh day of each calendar month",
    amount: 7,
    unit: "days",
    direction: "before",
    basis: "recurring",
    quoteVerified: true,
  }),
  deadlineUnverified: false,
};

const RISK: Risk = {
  title: "Immediate re-entry without notice",
  explanation: "The lessor can end the agreement and re-enter without going to court.",
  severity: "critical",
  clauseIds: ["CLAUSE-16"],
};

const CLOSED_DEADLINE: Obligation = {
  description: "Refund the security deposit.",
  party: "Licensor",
  clauseIds: ["CLAUSE-04"],
  deadline: deadline({
    quotedText: "within ninety (90) days",
    amount: 90,
    unit: "days",
    direction: "after",
    basis: "anchor",
    quoteVerified: true,
  }),
  deadlineUnverified: false,
};

function input(overrides: Partial<BriefInput> = {}): BriefInput {
  return {
    filename: "rent-agreement.pdf",
    pageCount: 2,
    clauseCount: 19,
    clauses: [
      { id: "PREAMBLE", text: "The parties.", kind: "preamble", index: 0, label: "Preamble" },
      { id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered", index: 1, label: "1" },
    ],
    summary: {
      documentType: "Rent agreement",
      headline: "An eleven-month residential tenancy in Mumbai.",
      sentences: [
        { text: "The term is eleven months.", clauseIds: ["CLAUSE-01"] },
        { text: "Rent is Rs. 45,000 a month.", clauseIds: ["CLAUSE-02"] },
      ],
    },
    risks: [RISK],
    obligations: [OBLIGATION, CLOSED_DEADLINE],
    keyDates: [],
    citations: { verifiedCount: 24, discardedCount: 0, droppedItemCount: 0, inventedIds: [] },
    analysis: {
      risksKept: 1,
      risksDropped: 0,
      obligationsKept: 2,
      obligationsDropped: 0,
      keyDatesKept: 0,
      keyDatesDropped: 0,
      unverifiedDeadlineQuotes: 0,
    },
    generation: { model: "gemini-3.6-flash", usedFallback: false },
    anchorDate: ANCHOR,
    ...overrides,
  };
}

describe("buildBrief — assembly", () => {
  it("carries the document identity through", () => {
    const brief = buildBrief(input());
    expect(brief.document.filename).toBe("rent-agreement.pdf");
    expect(brief.document.documentType).toBe("Rent agreement");
    expect(brief.document.headline).toContain("eleven-month");
    expect(brief.document.pageCount).toBe(2);
    expect(brief.document.clauseCount).toBe(19);
    expect(brief.document.anchorDate).toBe(ANCHOR);
  });

  it("turns the summary sentences into the situation section", () => {
    expect(buildBrief(input()).situation).toEqual([
      "The term is eleven months.",
      "Rent is Rs. 45,000 a month.",
    ]);
  });

  it("computes the date for an anchor-relative deadline", () => {
    const brief = buildBrief(input());
    const deposit = brief.obligations.find((item) => item.title === "Licensor");
    // 90 days after 01-Apr-2026.
    expect(deposit?.date).toBe("30-Jun-2026");
    expect(deposit?.dateNote).toBeUndefined();
  });

  it("explains rather than dates a recurring deadline", () => {
    const brief = buildBrief(input());
    const rent = brief.obligations.find((item) => item.title === "Licensee");
    expect(rent?.date).toBeUndefined();
    expect(rent?.quote).toContain("seventh day");
    expect(rent?.dateNote).toMatch(/repeats/i);
  });

  it("explains rather than dates an unverifiable deadline", () => {
    const brief = buildBrief(
      input({
        obligations: [{ ...CLOSED_DEADLINE, deadlineUnverified: true, deadline: deadline() }],
      }),
    );
    expect(brief.obligations[0].date).toBeUndefined();
    expect(brief.obligations[0].dateNote).toMatch(/could not be found/i);
  });

  it("keeps the severity label on each risk", () => {
    expect(buildBrief(input()).risks[0].severity).toBe("Critical");
  });

  it("produces a brief even when there is very little to put in it", () => {
    const brief = buildBrief(
      input({
        risks: [],
        obligations: [],
        keyDates: [],
        summary: { documentType: "Note", headline: "A very short note.", sentences: [] },
      }),
    );
    expect(brief.risks).toEqual([]);
    expect(brief.obligations).toEqual([]);
    expect(brief.questions.length).toBeGreaterThanOrEqual(0);
  });

  it("treats an invalid anchor date as no anchor rather than inventing one", () => {
    const brief = buildBrief(input({ anchorDate: "not-a-date" }));
    expect(brief.document.anchorDate).toBe("");
    const deposit = brief.obligations.find((item) => item.title === "Licensor");
    expect(deposit?.date).toBeUndefined();
  });
});

describe("buildBrief — questions", () => {
  it("produces at most five", () => {
    const brief = buildBrief(
      input({
        risks: [RISK, { ...RISK, title: "Second risk" }, { ...RISK, title: "Third risk" }],
        obligations: [OBLIGATION, CLOSED_DEADLINE, { ...CLOSED_DEADLINE, description: "Another duty entirely." }],
      }),
    );
    expect(brief.questions.length).toBeLessThanOrEqual(5);
  });

  it("reports how many candidates were left out", () => {
    const brief = buildBrief(
      input({
        risks: [RISK, { ...RISK, title: "Second risk" }, { ...RISK, title: "Third risk" }],
        obligations: [OBLIGATION, CLOSED_DEADLINE, { ...CLOSED_DEADLINE, description: "Another duty entirely." }],
      }),
    );
    expect(brief.moreQuestionsAvailable).toBeGreaterThan(0);
  });

  it("never reports a negative number of leftover questions", () => {
    expect(buildBrief(input()).moreQuestionsAvailable).toBeGreaterThanOrEqual(0);
  });
});

describe("briefToMarkdown", () => {
  const brief = buildBrief(input());
  const markdown = briefToMarkdown(brief);

  it("gives the document a title and identity", () => {
    expect(markdown).toContain("# Lawyer-prep brief");
    expect(markdown).toContain("rent-agreement.pdf");
  });

  it("carries the disclaimer with it, since the brief leaves the app", () => {
    expect(markdown).toMatch(/not legal advice/i);
    expect(markdown).toMatch(/not a substitute/i);
  });

  it("has a section for each part of the brief", () => {
    expect(markdown).toContain("## 1. Situation in short");
    expect(markdown).toContain("## 2. What this document requires");
    expect(markdown).toContain("## 3. Where it works against the reader");
    expect(markdown).toContain("## 4. Dates to diarise");
    expect(markdown).toContain("## 5. Questions to ask a lawyer");
  });

  it("points every item at the clause it came from", () => {
    expect(markdown).toContain("clause 2");
    expect(markdown).toContain("clause 16");
  });

  it("includes the computed date and the document's own words", () => {
    expect(markdown).toContain("30-Jun-2026");
    expect(markdown).toContain("on or before the seventh day of each calendar month");
  });

  it("numbers the questions rather than bullet-pointing them", () => {
    expect(markdown).toMatch(/\n1\. /);
  });

  it("states how the document was processed, so the reader can judge it", () => {
    expect(markdown).toMatch(/24\*\* citation\(s\) verified/);
    expect(markdown).toMatch(/computed by date arithmetic in the application, not by the language model/i);
  });

  it("says so plainly when a section is empty rather than leaving a blank heading", () => {
    const empty = briefToMarkdown(buildBrief(input({ risks: [], keyDates: [] })));
    expect(empty).toContain("_No risks were identified._");
    expect(empty).toContain("_The document does not fix any dates of its own._");
  });

  it("includes the anchor date when there is one, and omits the line when there is not", () => {
    expect(markdown).toContain("01-Apr-2026");
    expect(briefToMarkdown(buildBrief(input({ anchorDate: "" })))).not.toMatch(/counted from/i);
  });
});
