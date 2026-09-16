import { describe, expect, it } from "vitest";
import {
  buildLawyerQuestions,
  countAvailableQuestions,
  detectCoverageGaps,
  type QuestionInput,
} from "@/lib/brief/questions";
import type { KeyDate, Obligation, Risk } from "@/lib/summary/risks";
import type { DeadlineSpec } from "@/lib/deadlines";

const ANCHOR = "2026-04-01";

const CLAUSES = [
  { id: "PREAMBLE", text: "This Rent Agreement is made between the Licensor and the Licensee.", kind: "preamble" },
  { id: "CLAUSE-01", text: "The licence is for eleven (11) months commencing on 01-Apr-2026.", kind: "numbered" },
  { id: "CLAUSE-02", text: "Rent of Rs. 45,000 is payable on the seventh day of each calendar month.", kind: "numbered" },
  {
    id: "CLAUSE-03",
    text: "Any dispute shall be referred to arbitration, and the notice to terminate is one month.",
    kind: "numbered",
  },
];

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

function risk(overrides: Partial<Risk> = {}): Risk {
  return {
    title: "Immediate re-entry without notice",
    explanation: "The lessor can re-enter and end the agreement without going to court.",
    severity: "critical",
    clauseIds: ["CLAUSE-03"],
    ...overrides,
  };
}

function obligation(overrides: Partial<Obligation> = {}): Obligation {
  return {
    description: "Pay the monthly rent of Rs. 45,000.",
    party: "Licensee",
    clauseIds: ["CLAUSE-02"],
    deadline: deadline(),
    deadlineUnverified: false,
    ...overrides,
  };
}

function keyDate(overrides: Partial<KeyDate> = {}): KeyDate {
  return {
    label: "End of the 11-month term",
    clauseIds: ["CLAUSE-01"],
    deadline: deadline({
      quotedText: "eleven (11) months",
      amount: 11,
      unit: "months",
      direction: "after",
      basis: "anchor",
      quoteVerified: true,
    }),
    ...overrides,
  };
}

function input(overrides: Partial<QuestionInput> = {}): QuestionInput {
  return {
    risks: [],
    obligations: [],
    keyDates: [],
    clauses: CLAUSES,
    anchorDate: ANCHOR,
    ...overrides,
  };
}

describe("buildLawyerQuestions — shape and limits", () => {
  it("returns at most five", () => {
    const questions = buildLawyerQuestions(
      input({
        risks: [
          risk(),
          risk({ title: "One-sided arbitrator", clauseIds: ["CLAUSE-03"] }),
          risk({ title: "Rent escalation", severity: "medium", clauseIds: ["CLAUSE-02"] }),
        ],
        obligations: [obligation(), obligation({ description: "Pay the society maintenance charges.", clauseIds: ["CLAUSE-02"] })],
        keyDates: [keyDate()],
      }),
    );
    expect(questions).toHaveLength(5);
  });

  it("never returns a duplicate question", () => {
    // Two risks with identical wording must not both appear.
    const questions = buildLawyerQuestions(input({ risks: [risk(), risk()] }));
    const texts = questions.map((question) => question.question);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("returns fewer than five rather than padding when there is nothing to ask about", () => {
    // A document that mentions every topic yields nothing to ask about, and the
    // list must not invent filler to reach five.
    const covered = [
      "Notices, deposits, disputes, arbitration, termination, expiry, repairs, maintenance,",
      "increases, escalation, liability, indemnity and insurance are all dealt with here.",
    ].join(" ");

    const questions = buildLawyerQuestions(
      input({ clauses: [{ id: "CLAUSE-01", text: covered, kind: "numbered" }] }),
    );
    expect(questions).toEqual([]);
  });

  it("caps how much of the list generic gap questions may take", () => {
    // Five generic questions is not a tailored brief, so no more than two.
    const questions = buildLawyerQuestions(
      input({ clauses: [{ id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered" }] }),
    );
    expect(
      questions.filter((question) => question.source === "coverage").length,
    ).toBeLessThanOrEqual(2);
  });

  it("respects a caller-supplied target", () => {
    const questions = buildLawyerQuestions(
      input({ risks: [risk(), risk({ title: "Second" }), risk({ title: "Third" })] }),
      2,
    );
    expect(questions).toHaveLength(2);
  });

  it("counts candidates it could not fit", () => {
    const sizeable = input({
      risks: [risk(), risk({ title: "Second" }), risk({ title: "Third" })],
      obligations: [obligation(), obligation({ description: "Another duty entirely." })],
    });
    expect(countAvailableQuestions(sizeable)).toBeGreaterThan(5);
  });
});

describe("buildLawyerQuestions — ranking", () => {
  it("puts risks before everything derived from duties", () => {
    const questions = buildLawyerQuestions(
      input({
        risks: [risk()],
        obligations: [obligation({ deadline: deadline({ quotedText: "on the seventh day", basis: "recurring", quoteVerified: true }) })],
      }),
    );
    expect(questions[0].source).toBe("risk");
  });

  it("orders risks most serious first", () => {
    const questions = buildLawyerQuestions(
      input({
        risks: [
          risk({ title: "Minor thing", severity: "low" }),
          risk({ title: "Serious thing", severity: "critical" }),
          risk({ title: "Middling thing", severity: "medium" }),
        ],
      }),
    );
    // Only the first three are risk-derived; gap questions may follow.
    expect(questions.slice(0, 3).map((question) => question.about)).toEqual([
      "Serious thing",
      "Middling thing",
      "Minor thing",
    ]);
  });

  it("ranks coverage gaps last, after anything drawn from a real clause", () => {
    const questions = buildLawyerQuestions(
      input({
        risks: [risk()],
        // CLAUSES mention notice, arbitration, deposit and rent, so only the
        // topics genuinely absent will appear -- and they must not outrank the
        // risk question.
        clauses: [{ id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered" }],
      }),
    );
    const coverageAt = questions.findIndex((question) => question.source === "coverage");
    const riskAt = questions.findIndex((question) => question.source === "risk");
    if (coverageAt !== -1) expect(coverageAt).toBeGreaterThan(riskAt);
  });
});

describe("buildLawyerQuestions — every question is traceable", () => {
  it("carries the clause IDs of the risk it came from", () => {
    const questions = buildLawyerQuestions(input({ risks: [risk()] }));
    expect(questions[0].clauseIds).toEqual(["CLAUSE-03"]);
  });

  it("quotes the deadline wording and the computed date for a deadline question", () => {
    const questions = buildLawyerQuestions(
      input({
        obligations: [
          obligation({
            deadline: deadline({
              quotedText: "on or before the seventh day of each calendar month",
              amount: 7,
              unit: "days",
              direction: "before",
              basis: "recurring",
              quoteVerified: true,
            }),
          }),
        ],
      }),
    );
    const question = questions[0];
    expect(question.source).toBe("deadline");
    expect(question.question).toContain("on or before the seventh day of each calendar month");
    expect(question.clauseIds).toEqual(["CLAUSE-02"]);
  });

  it("uses the computed date for a key date, from the anchor", () => {
    const questions = buildLawyerQuestions(input({ keyDates: [keyDate()] }));
    const question = questions.find((entry) => entry.source === "deadline");
    // 11 months after 01-Apr-2026.
    expect(question?.question).toContain("01-Mar-2027");
  });

  it("gives a coverage question no citation, because no clause covers it", () => {
    const questions = buildLawyerQuestions(
      input({ clauses: [{ id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered" }] }),
    );
    const coverage = questions.filter((question) => question.source === "coverage");
    expect(coverage.length).toBeGreaterThan(0);
    for (const question of coverage) expect(question.clauseIds).toEqual([]);
  });

  it("never invents a citation for any question", () => {
    const known = new Set(CLAUSES.map((clause) => clause.id));
    const questions = buildLawyerQuestions(
      input({
        risks: [risk(), risk({ title: "Deposit forfeiture", clauseIds: ["CLAUSE-02"] })],
        obligations: [obligation()],
        keyDates: [keyDate()],
      }),
    );
    for (const question of questions) {
      for (const id of question.clauseIds) expect(known.has(id)).toBe(true);
    }
  });
});

describe("detectCoverageGaps — what the document does and does not mention", () => {
  it("does not flag a topic the document covers", () => {
    const gaps = detectCoverageGaps([
      { id: "CLAUSE-01", text: "Either party may end this agreement by giving one month's notice.", kind: "numbered" },
      { id: "CLAUSE-02", text: "The security deposit is refunded within 90 days.", kind: "numbered" },
      { id: "CLAUSE-03", text: "Disputes go to arbitration under Indian law.", kind: "numbered" },
      { id: "CLAUSE-04", text: "The tenant shall carry out all repairs.", kind: "numbered" },
    ]);
    const abouts = gaps.map((gap) => gap.about);
    expect(abouts).not.toContain("notice to end the agreement");
    expect(abouts).not.toContain("the security deposit and its return");
    expect(abouts).not.toContain("how disputes are resolved");
    expect(abouts).not.toContain("repairs and maintenance");
  });

  it("recognises the plural and derived forms contracts actually use", () => {
    // The first cut matched \bdispute\b and \brepair\b, so "Disputes" and
    // "repairs" were read as absent. Reporting a topic as missing when the
    // document covers it is the harmful direction of error, so this is pinned.
    const gaps = detectCoverageGaps([
      {
        id: "CLAUSE-01",
        text: "All disputes are referred to arbitration. Notices must be written. Deposits are refundable. Repairs are shared. Increases require consent. Liability is capped. Termination is permitted. Insurance is required.",
        kind: "numbered",
      },
    ]);
    expect(gaps).toEqual([]);
  });

  it("flags a topic the document is silent on, phrased as the absence it is", () => {
    const gaps = detectCoverageGaps([{ id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered" }]);
    const dispute = gaps.find((gap) => gap.about === "how disputes are resolved");
    expect(dispute?.question).toMatch(/does not appear to address/i);
  });

  it("ignores the preamble, which is not the operative part of the document", () => {
    const gaps = detectCoverageGaps([
      { id: "PREAMBLE", text: "This mentions repair work only.", kind: "preamble" },
      { id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered" },
    ]);
    expect(gaps.map((gap) => gap.about)).toContain("repairs and maintenance");
  });

  it("gives a gap question no citation, because no clause covers it", () => {
    const gaps = detectCoverageGaps([{ id: "CLAUSE-01", text: "Rent is payable monthly.", kind: "numbered" }]);
    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) expect(gap.clauseIds).toEqual([]);
  });
});
