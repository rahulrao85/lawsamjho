import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  generateSummary,
  maxExpectedSentences,
  SummaryGenerationError,
} from "@/lib/summary/generate";
import { resetServerEnvCache } from "@/lib/env";
import { resetProviderCache } from "@/lib/llm/gemini";
import type { Clause } from "@/lib/segment";
import type { StructuredGenerator } from "@/lib/llm/structured";

const SAMPLE_CLAUSES: Clause[] = [
  { id: "CLAUSE-01", text: "The term is eleven months.", kind: "numbered", index: 1, label: "1" },
  { id: "CLAUSE-02", text: "Monthly rent is 45,000.", kind: "numbered", index: 2, label: "2" },
];

function validModelPayload() {
  return {
    documentType: "Rent Agreement",
    headline: "An eleven-month residential tenancy.",
    sentences: [
      { text: "The term is eleven months.", clauseIds: ["CLAUSE-01"] },
      { text: "Rent is 45,000.", clauseIds: ["CLAUSE-02"] },
    ],
    keyTerms: [
      { term: "Licensee", plainMeaning: "The tenant occupying the premises.", clauseIds: ["CLAUSE-01"] },
    ],
    risks: [
      {
        title: "Late fee penalty",
        explanation: "Charges for late rent.",
        severity: "medium",
        clauseIds: ["CLAUSE-02"],
      },
    ],
    obligations: [
      {
        party: "Licensee",
        description: "Pay the rent on time.",
        clauseIds: ["CLAUSE-02"],
        deadlineQuotedText: "",
        deadlineAmount: "",
        deadlineUnit: "",
        deadlineDirection: "",
        deadlineBasis: "none",
      },
    ],
    keyDates: [],
  };
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  resetServerEnvCache();
  resetProviderCache();
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  resetServerEnvCache();
  resetProviderCache();
});

describe("maxExpectedSentences", () => {
  it("computes clauseCount * 2 + 12", () => {
    expect(maxExpectedSentences(0)).toBe(12);
    expect(maxExpectedSentences(5)).toBe(22);
    expect(maxExpectedSentences(18)).toBe(48);
  });
});

describe("generateSummary", () => {
  it("throws SummaryGenerationError when clauses array is empty", async () => {
    await expect(generateSummary({ clauses: [] })).rejects.toThrow(SummaryGenerationError);
  });

  it("successfully parses and verifies a valid model response", async () => {
    const mockGenerator: StructuredGenerator = async () => ({
      object: validModelPayload(),
    });

    const result = await generateSummary({
      clauses: SAMPLE_CLAUSES,
      generate: mockGenerator,
    });

    expect(result.summary.documentType).toBe("Rent Agreement");
    expect(result.summary.headline).toContain("eleven-month");
    expect(result.summary.sentences).toHaveLength(2);
    expect(result.citations.verifiedCount).toBeGreaterThanOrEqual(2);
    expect(result.risks).toHaveLength(1);
    expect(result.obligations).toHaveLength(1);
  });

  it("rejects when summary exceeds sentence budget", async () => {
    const payload = validModelPayload();
    // Exceed the budget for 2 clauses (budget is 2*2 + 12 = 16)
    payload.sentences = Array.from({ length: 20 }, (_, i) => ({
      text: `Sentence ${i}`,
      clauseIds: ["CLAUSE-01"],
    }));

    const mockGenerator: StructuredGenerator = async () => ({
      object: payload,
    });

    await expect(
      generateSummary({
        clauses: SAMPLE_CLAUSES,
        generate: mockGenerator,
      }),
    ).rejects.toThrow();
  });

  it("rejects when all summary sentences cite non-existent clauses", async () => {
    const payload = validModelPayload();
    payload.sentences = [
      { text: "Ungrounded sentence.", clauseIds: ["CLAUSE-999"] },
    ];

    const mockGenerator: StructuredGenerator = async () => ({
      object: payload,
    });

    await expect(
      generateSummary({
        clauses: SAMPLE_CLAUSES,
        generate: mockGenerator,
      }),
    ).rejects.toThrow();
  });
});
