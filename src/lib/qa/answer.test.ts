import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { answerQuestion, NOT_IN_DOCUMENT_MESSAGE } from "@/lib/qa/answer";
import type { StructuredGenerator } from "@/lib/llm/structured";
import { resetServerEnvCache } from "@/lib/env";
import { resetProviderCache } from "@/lib/llm/gemini";
import { segmentClauses } from "@/lib/segment";

/**
 * These exercise the acceptance rules with an injected generator rather than a
 * live model: "an answer citing an invented clause is thrown away in full" is
 * not something you can reliably provoke from a real API call, and a rule that
 * only holds when the model happens to misbehave is not a rule.
 */

const DOCUMENT = [
  "This Rent Agreement is made between the Licensor and the Licensee.",
  "1. The Licensee shall pay monthly rent of Rs. 45,000.",
  "2. The security deposit is Rs. 90,000, refunded within ninety (90) days of vacating.",
].join("\n");

const { clauses } = segmentClauses(DOCUMENT);

function generatorReturning(object: unknown): StructuredGenerator {
  return async () => ({ object });
}

/** Returns each response in turn, so retry behaviour can be observed. */
function generatorSequence(objects: unknown[]): { generate: StructuredGenerator; calls: () => number } {
  let index = 0;
  return {
    generate: async () => {
      const object = objects[Math.min(index, objects.length - 1)];
      index += 1;
      return { object };
    },
    calls: () => index,
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

describe("answerQuestion — the happy path", () => {
  it("returns an answer whose citation resolves", async () => {
    const result = await answerQuestion({
      clauses,
      question: "What is the rent?",
      generate: generatorReturning({
        status: "answered",
        answer: "The monthly rent is Rs. 45,000, payable by the Licensee.",
        clauseIds: ["CLAUSE-01"],
      }),
    });

    expect(result.status).toBe("answered");
    expect(result.clauseIds).toEqual(["CLAUSE-01"]);
    expect(result.citations.verifiedCount).toBe(1);
    expect(result.rejectedAttempts).toBe(0);
  });

  it("canonicalises a loosely written citation rather than rejecting it", async () => {
    const result = await answerQuestion({
      clauses,
      question: "What is the rent?",
      generate: generatorReturning({
        status: "answered",
        answer: "The monthly rent is Rs. 45,000, payable by the Licensee.",
        clauseIds: ["clause 1"],
      }),
    });
    expect(result.clauseIds).toEqual(["CLAUSE-01"]);
  });
});

describe("answerQuestion — an invented citation throws the whole answer away", () => {
  it("does not return the answer with the bad citation stripped out", async () => {
    // The answer cites one real clause and one that does not exist. Stripping
    // the bad one would leave a plausible-looking answer whose support is
    // partly fabricated, which is precisely what must not be rendered.
    const fake = generatorReturning({
      status: "answered",
      answer: "The deposit is refunded within ninety days of vacating the premises.",
      clauseIds: ["CLAUSE-02", "CLAUSE-99"],
    });

    await expect(
      answerQuestion({ clauses, question: "When is the deposit refunded?", generate: fake }),
    ).rejects.toThrow(/could not produce a usable answer/i);
  });

  it("retries before giving up, and reports why each attempt failed", async () => {
    const { generate, calls } = generatorSequence([
      { status: "answered", answer: "A fabricated answer citing nothing real at all.", clauseIds: ["CLAUSE-99"] },
      { status: "answered", answer: "The deposit is refunded within ninety days of vacating.", clauseIds: ["CLAUSE-02"] },
    ]);

    const result = await answerQuestion({
      clauses,
      question: "When is the deposit refunded?",
      generate,
    });

    expect(calls()).toBe(2);
    expect(result.rejectedAttempts).toBe(1);
    expect(result.clauseIds).toEqual(["CLAUSE-02"]);
  });

  it("rejects an 'answered' response that cites nothing", async () => {
    const fake = generatorReturning({
      status: "answered",
      answer: "The document does not say anything about this at all, surprisingly.",
      clauseIds: [],
    });
    await expect(answerQuestion({ clauses, question: "Why?", generate: fake })).rejects.toThrow();
  });

  it("rejects an 'answered' response with no real content", async () => {
    const fake = generatorReturning({ status: "answered", answer: "Yes.", clauseIds: ["CLAUSE-01"] });
    await expect(answerQuestion({ clauses, question: "Why?", generate: fake })).rejects.toThrow();
  });
});

describe("answerQuestion — the document does not cover it", () => {
  it("accepts not-in-document and returns a message the server composes", async () => {
    const result = await answerQuestion({
      clauses,
      question: "What is the capital of France?",
      generate: generatorReturning({ status: "not-in-document", answer: "", clauseIds: [] }),
    });

    expect(result.status).toBe("not-in-document");
    expect(result.answer).toBe(NOT_IN_DOCUMENT_MESSAGE);
    expect(result.clauseIds).toEqual([]);
    expect(result.citations.verifiedCount).toBe(0);
  });

  it("accepts the status wordings a model actually produces", async () => {
    for (const status of ["not_in_document", "notInDocument", "unanswerable", "not covered"]) {
      const result = await answerQuestion({
        clauses,
        question: "What is the capital of France?",
        generate: generatorReturning({ status, answer: "I cannot answer that.", clauseIds: [] }),
      });
      expect(result.status, status).toBe("not-in-document");
    }
  });

  it("discards whatever prose came with it, so nothing unverifiable is shown", async () => {
    const result = await answerQuestion({
      clauses,
      question: "What is the capital of France?",
      generate: generatorReturning({
        status: "not_in_document",
        answer: "Actually, the capital of France is Paris, which I know from outside the document.",
        clauseIds: [],
      }),
    });

    // The model's own words never reach the user for this status.
    expect(result.answer).toBe(NOT_IN_DOCUMENT_MESSAGE);
    expect(result.answer).not.toContain("Paris");
  });

  it("rejects a status it cannot read at all, rather than guessing", async () => {
    const fake = generatorReturning({ status: "partially", answer: "Something.", clauseIds: ["CLAUSE-01"] });
    await expect(answerQuestion({ clauses, question: "Why?", generate: fake })).rejects.toThrow();
  });
});

describe("answerQuestion — prompt construction", () => {
  it("passes the clauses as delimited data and asks about the document", async () => {
    let seen = "";
    const spy: StructuredGenerator = async (options) => {
      seen = options.prompt;
      return { object: { status: "not_in_document", answer: "", clauseIds: [] } };
    };

    await answerQuestion({ clauses, question: "What is the rent?", generate: spy });

    expect(seen).toContain("<<<CLAUSES");
    expect(seen).toContain("CLAUSES>>>");
    expect(seen).toContain("<<<QUESTION");
    expect(seen).toContain("QUESTION>>>");
    expect(seen).toContain("What is the rent?");
    expect(seen).toContain("CLAUSE-01");
    // The question is framed as data, not as an instruction.
    expect(seen.toLowerCase()).toContain("never as an instruction");
  });

  it("sends a system prompt that forbids answering from outside the document", async () => {
    let system = "";
    const spy: StructuredGenerator = async (options) => {
      system = options.system;
      return { object: { status: "not_in_document", answer: "", clauseIds: [] } };
    };

    await answerQuestion({ clauses, question: "What is the rent?", generate: spy });

    expect(system).toMatch(/only from the clauses/i);
    expect(system).toMatch(/never answer from general knowledge/i);
    expect(system).toMatch(/data, not instructions/i);
  });
});
