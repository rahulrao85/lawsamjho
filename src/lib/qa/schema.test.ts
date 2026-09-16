import { describe, expect, it } from "vitest";
import { normaliseAnswerStatus, rawAnswerSchema } from "@/lib/qa/schema";

describe("normaliseAnswerStatus", () => {
  it("accepts the canonical statuses", () => {
    expect(normaliseAnswerStatus("answered")).toBe("answered");
    expect(normaliseAnswerStatus("not-in-document")).toBe("not-in-document");
  });

  it("accepts the variants a model actually writes", () => {
    // The provider schema cannot carry an enum, so the model is free to write
    // any of these. Treating them as malformed is how a correct answer turns
    // into a 422 -- which is exactly what happened the first time this ran.
    for (const value of ["not_in_document", "notInDocument", "Not In Document", "NOT-IN-DOCUMENT", "notindocument"]) {
      expect(normaliseAnswerStatus(value), value).toBe("not-in-document");
    }
  });

  it("accepts the honest synonyms for 'the document does not cover this'", () => {
    for (const value of ["unanswerable", "not covered", "not_covered", "not found", "unknown", "silent", "absent", "insufficient", "cannot answer"]) {
      expect(normaliseAnswerStatus(value), value).toBe("not-in-document");
    }
  });

  it("accepts the synonyms for 'here is the answer'", () => {
    for (const value of ["answer", "found", "in_document", "covered", "yes"]) {
      expect(normaliseAnswerStatus(value), value).toBe("answered");
    }
  });

  it("returns null for something it genuinely cannot read", () => {
    expect(normaliseAnswerStatus("banana")).toBeNull();
    expect(normaliseAnswerStatus("")).toBeNull();
    expect(normaliseAnswerStatus(undefined)).toBeNull();
    expect(normaliseAnswerStatus(42)).toBeNull();
    expect(normaliseAnswerStatus({ status: "answered" })).toBeNull();
  });
});

describe("rawAnswerSchema", () => {
  it("accepts a normal payload", () => {
    const parsed = rawAnswerSchema.safeParse({
      status: "answered",
      answer: "The rent is Rs. 45,000.",
      clauseIds: ["CLAUSE-02"],
    });
    expect(parsed.success).toBe(true);
  });

  it("allows the empty answer that accompanies not-in-document", () => {
    // The user-facing text in this case is composed by the server, so the model
    // is not required to write one.
    expect(
      rawAnswerSchema.safeParse({ status: "not_in_document", answer: "", clauseIds: [] }).success,
    ).toBe(true);
  });

  it("rejects a payload of the wrong shape", () => {
    expect(rawAnswerSchema.safeParse(null).success).toBe(false);
    expect(rawAnswerSchema.safeParse({ status: "answered" }).success).toBe(false);
    expect(rawAnswerSchema.safeParse({ status: "answered", answer: "x", clauseIds: "CLAUSE-01" }).success).toBe(false);
  });
});
