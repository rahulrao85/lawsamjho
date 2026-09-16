import { describe, expect, it } from "vitest";
import { clauseIdSet, segmentClauses } from "@/lib/segment";
import { canonicaliseClauseId, verifyClauseIds, verifyItems } from "@/lib/summary/verify";

const KNOWN = new Set(["PREAMBLE", "CLAUSE-01", "CLAUSE-02", "CLAUSE-03"]);

describe("canonicaliseClauseId", () => {
  it("accepts the canonical form", () => {
    expect(canonicaliseClauseId("CLAUSE-02", KNOWN)).toBe("CLAUSE-02");
  });

  it("accepts the many ways a model writes the same reference", () => {
    for (const raw of [
      "clause 2",
      "Clause 2",
      "CLAUSE 2",
      "CLAUSE-2",
      "clause_2",
      "Clause 2.",
      "CLAUSE-02",
      "2",
      "02",
      "#2",
      "¶2",
      "para 2",
      "paragraph 2",
      "section 2",
      "sec 2",
      "art 2",
      "article 2",
      "[CLAUSE-02]",
      "`CLAUSE-02`",
      "  CLAUSE-02  ",
      "(CLAUSE-02)",
      "CLAUSE-02,",
    ]) {
      expect(canonicaliseClauseId(raw, KNOWN), `raw: ${raw}`).toBe("CLAUSE-02");
    }
  });

  it("accepts the preamble by name and by id", () => {
    expect(canonicaliseClauseId("PREAMBLE", KNOWN)).toBe("PREAMBLE");
    expect(canonicaliseClauseId("preamble", KNOWN)).toBe("PREAMBLE");
    expect(canonicaliseClauseId("Preamble", KNOWN)).toBe("PREAMBLE");
  });

  it("rejects references to clauses that do not exist", () => {
    for (const raw of [
      "CLAUSE-14",
      "clause 9",
      "14",
      "CLAUSE-00",
      "Section 7",
      "CLAUSE-",
      "clause abc",
    ]) {
      expect(canonicaliseClauseId(raw, KNOWN), `raw: ${raw}`).toBeNull();
    }
  });

  it("rejects junk instead of coercing it into a number", () => {
    for (const raw of ["", "   ", "the first clause", "clauses 1 and 2", "null", "n/a", "-1"]) {
      expect(canonicaliseClauseId(raw, KNOWN), `raw: ${raw}`).toBeNull();
    }
  });

  it("rejects a preamble reference when the document has no preamble", () => {
    expect(canonicaliseClauseId("PREAMBLE", new Set(["CLAUSE-01"]))).toBeNull();
  });
});

describe("verifyClauseIds", () => {
  it("keeps real citations and reports invented ones", () => {
    const { kept, discarded } = verifyClauseIds(
      ["CLAUSE-01", "CLAUSE-14", "clause 3", "CLAUSE-99"],
      KNOWN,
    );
    expect(kept).toEqual(["CLAUSE-01", "CLAUSE-03"]);
    expect(discarded).toEqual(["CLAUSE-14", "CLAUSE-99"]);
  });

  it("de-duplicates after canonicalising different spellings of one clause", () => {
    const { kept } = verifyClauseIds(["CLAUSE-02", "clause 2", "2", "CLAUSE-2"], KNOWN);
    expect(kept).toEqual(["CLAUSE-02"]);
  });

  it("preserves the order the model gave", () => {
    const { kept } = verifyClauseIds(["clause 3", "CLAUSE-01"], KNOWN);
    expect(kept).toEqual(["CLAUSE-03", "CLAUSE-01"]);
  });
});

describe("verifyItems", () => {
  type Item = { text: string; clauseIds: string[] };

  it("drops an item whose only citation was invented", () => {
    const { resolved, report } = verifyItems<Item>(
      [
        { text: "Rent is payable monthly.", clauseIds: ["CLAUSE-01"] },
        { text: "A claim resting on nothing.", clauseIds: ["CLAUSE-42"] },
      ],
      (item) => item.clauseIds,
      KNOWN,
    );

    expect(resolved.map((r) => r.value.text)).toEqual(["Rent is payable monthly."]);
    expect(report.droppedItemCount).toBe(1);
    expect(report.discardedCount).toBe(1);
    expect(report.inventedIds).toEqual(["CLAUSE-42"]);
  });

  it("keeps an item when at least one citation survives, dropping only the bad one", () => {
    const { resolved, report } = verifyItems<Item>(
      [{ text: "Mixed citation.", clauseIds: ["CLAUSE-99", "clause 1"] }],
      (item) => item.clauseIds,
      KNOWN,
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0].clauseIds).toEqual(["CLAUSE-01"]);
    expect(report.verifiedCount).toBe(1);
    expect(report.discardedCount).toBe(1);
    expect(report.droppedItemCount).toBe(0);
  });

  it("reports each distinct invented id once, however many items used it", () => {
    const { report } = verifyItems<Item>(
      [
        { text: "One.", clauseIds: ["CLAUSE-42"] },
        { text: "Two.", clauseIds: ["CLAUSE-42", "CLAUSE-43"] },
      ],
      (item) => item.clauseIds,
      KNOWN,
    );
    expect(report.inventedIds).toEqual(["CLAUSE-42", "CLAUSE-43"]);
    expect(report.discardedCount).toBe(3);
    expect(report.droppedItemCount).toBe(2);
  });

  it("caps the invented-id list so one bad generation cannot flood the UI", () => {
    const many = Array.from({ length: 30 }, (_unused, index) => ({
      text: `Item ${index}.`,
      clauseIds: [`CLAUSE-${100 + index}`],
    }));
    const { report } = verifyItems<Item>(many, (item) => item.clauseIds, KNOWN);
    expect(report.discardedCount).toBe(30);
    expect(report.inventedIds.length).toBeLessThanOrEqual(8);
  });

  it("handles a model that cites nothing at all", () => {
    const { resolved, report } = verifyItems<Item>(
      [{ text: "No citation.", clauseIds: [] }],
      (item) => item.clauseIds,
      KNOWN,
    );
    expect(resolved).toEqual([]);
    expect(report.droppedItemCount).toBe(1);
  });
});

describe("verify.ts integrates with the real segmenter", () => {
  it("accepts ids produced by segmentClauses and rejects the neighbours", () => {
    const { clauses } = segmentClauses(
      [
        "THIS DEED is made between the parties named below.",
        "1. The term is eleven months.",
        "2. The rent is Rs. 45,000 per month.",
      ].join("\n"),
    );
    const known = clauseIdSet(clauses);

    expect(canonicaliseClauseId("CLAUSE-01", known)).toBe("CLAUSE-01");
    expect(canonicaliseClauseId("CLAUSE-02", known)).toBe("CLAUSE-02");
    expect(canonicaliseClauseId("CLAUSE-03", known)).toBeNull();
    expect(canonicaliseClauseId("PREAMBLE", known)).toBe("PREAMBLE");
  });
});
