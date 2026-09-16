import { describe, expect, it } from "vitest";
import {
  clauseId,
  clauseIdSet,
  normaliseText,
  parseClauseId,
  segmentClauses,
} from "@/lib/segment";

describe("clauseId / parseClauseId", () => {
  it("pads to two digits and stays sortable past 99", () => {
    expect(clauseId(1)).toBe("CLAUSE-01");
    expect(clauseId(9)).toBe("CLAUSE-09");
    expect(clauseId(10)).toBe("CLAUSE-10");
    expect(clauseId(100)).toBe("CLAUSE-100");
  });

  it("round-trips", () => {
    for (const index of [1, 7, 42, 999]) {
      expect(parseClauseId(clauseId(index))).toBe(index);
    }
  });

  it("rejects anything that is not a clause id", () => {
    for (const value of ["", "CLAUSE-", "CLAUSE-0", "CLAUSE-00", "7", "SEC-07", "CLAUSE-ABC"]) {
      expect(parseClauseId(value)).toBeNull();
    }
  });
});

describe("normaliseText", () => {
  it("unifies line endings and strips form feeds", () => {
    expect(normaliseText("a\r\nb\rc\fd")).toBe("a\nb\nc\nd");
  });

  it("collapses inline whitespace and trims lines", () => {
    expect(normaliseText("  a   b \t c  ")).toBe("a b c");
  });

  it("drops a page number stranded on its own line", () => {
    // Real extraction from the 36-page agreement put "1" on its own line
    // between the cover text and the title.
    expect(normaliseText("COVER TEXT\n1\nAGREEMENT FOR SALE")).toBe(
      "COVER TEXT\nAGREEMENT FOR SALE",
    );
  });

  it("keeps a numbered clause line, which is never a bare number", () => {
    expect(normaliseText("1. The Developer agrees")).toBe("1. The Developer agrees");
  });

  it("collapses runs of blank lines to a single break", () => {
    expect(normaliseText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });
});

describe("segmentClauses — numbered documents", () => {
  const numbered = [
    "1. The Promoter hereby agrees to sell the flat to the Purchaser.",
    "2.1 The Purchaser shall pay the consideration in instalments as set out herein.",
    "2.2 Time is of the essence for both parties under this agreement.",
    "3. This agreement shall be governed by the laws of India.",
  ].join("\n");

  it("splits on numeric markers and labels them as written", () => {
    const result = segmentClauses(numbered);
    expect(result.strategy).toBe("numbered");
    expect(result.clauses).toHaveLength(4);
    expect(result.clauses.map((c) => c.label)).toEqual(["1", "2.1", "2.2", "3"]);
  });

  it("gives gapless IDs that match array position", () => {
    const { clauses } = segmentClauses(numbered);
    clauses.forEach((clause, position) => {
      expect(clause.id).toBe(clauseId(position + 1));
      expect(clause.index).toBe(position + 1);
    });
  });

  it("strips the marker out of the clause body", () => {
    const { clauses } = segmentClauses(numbered);
    expect(clauses[0].text).toBe(
      "The Promoter hereby agrees to sell the flat to the Purchaser.",
    );
    expect(clauses[1].text.startsWith("The Purchaser shall pay")).toBe(true);
    expect(clauses[1].text).not.toContain("2.1");
  });

  it("accepts word markers and keeps their number as the label", () => {
    const result = segmentClauses(
      "CLAUSE 1: The term is eleven months.\nCLAUSE 2: Rent is due on the fifth.",
    );
    expect(result.clauses.map((c) => c.label)).toEqual(["1", "2"]);
    expect(result.clauses[0].text).toBe("The term is eleven months.");
  });

  it("carries wrapped body lines into one clause instead of splitting them", () => {
    const wrapped = [
      "1. The Developer has proposed to construct the building to be known",
      "as set out in the schedule and shall complete the same within the",
      "period stated in clause 2.",
      "2. The Purchaser agrees to pay the price.",
    ].join("\n");
    const { clauses } = segmentClauses(wrapped);
    expect(clauses).toHaveLength(2);
    expect(clauses[0].text).toContain("period stated in clause 2.");
  });
});

describe("segmentClauses — guards against numbers that are not clauses", () => {
  it("rejects measurements that look like dotted clause numbers", () => {
    // Observed verbatim in the real agreement: a dotted quantity at line start.
    const result = segmentClauses(
      [
        "836.1 Sq. Meters together with structure standing thereon known as",
        "12.50% share and collectively 25% share in the said Land",
        "1. The Developer has proposed to construct the building.",
        "2. The Purchaser agrees to the above.",
      ].join("\n"),
    );
    expect(result.clauses.map((c) => c.label)).toEqual(["Preamble", "1", "2"]);
    // The measurement must not have started a clause of its own...
    expect(result.clauses.slice(1).map((c) => c.text).join(" ")).not.toContain("Sq. Meters");
    // ...but it must not have been thrown away either.
    expect(result.clauses[0].text).toContain("Sq. Meters");
  });

  it("rejects a reordered footnote number far beyond the running sequence", () => {
    // A three-digit item, which does match the numbered-clause shape, landing
    // while the real clauses are only at 1..3.
    const result = segmentClauses(
      [
        "1. The Developer has proposed to construct the building.",
        "2. The Purchaser agrees to purchase the flat.",
        "908. In accordance with the terms and conditions set out in this",
        "3. This agreement is governed by Indian law.",
      ].join("\n"),
    );
    expect(result.clauses.map((c) => c.label)).toEqual(["1", "2", "3"]);
    expect(result.warnings.join(" ")).toMatch(/outside the document's numbering sequence/);
  });

  it("treats a four-digit number as body text, since it cannot be a clause marker", () => {
    const result = segmentClauses(
      [
        "1. The Developer has proposed to construct the building.",
        "2. The Purchaser agrees to purchase the flat.",
        "1908. In accordance with the terms and conditions set out in this",
        "3. This agreement is governed by Indian law.",
      ].join("\n"),
    );
    expect(result.clauses.map((c) => c.label)).toEqual(["1", "2", "3"]);
    expect(result.warnings).toEqual([]);
  });

  it("keeps both marker numbers when a sub-clause follows its parent", () => {
    const result = segmentClauses(
      [
        "1. The Developer has proposed to construct the building to be known as",
        "the schedule, and shall complete it within the stated period.",
        "2.1 The Purchaser shall pay the consideration in instalments.",
        "2.2 Time is of the essence.",
      ].join("\n"),
    );
    expect(result.clauses.map((c) => c.label)).toEqual(["1", "2.1", "2.2"]);
  });

  it("still allows a downward restart, as used by per-section numbering", () => {
    const result = segmentClauses(
      [
        "1. Section one first clause.",
        "2. Section one second clause.",
        "1. Section two first clause.",
        "2. Section two second clause.",
      ].join("\n"),
    );
    expect(result.clauses).toHaveLength(4);
  });

  it("rejects a marker whose body is only one character", () => {
    const result = segmentClauses(
      [
        "1. The term is eleven months and renewable by consent of both parties.",
        "2. x",
        "3. Rent is payable in advance on or before the fifth day of each month.",
      ].join("\n"),
    );
    expect(result.clauses.map((c) => c.label)).toEqual(["1", "3"]);
  });
});

describe("segmentClauses — preamble", () => {
  const withPreamble = [
    "THIS RENT AGREEMENT is made at Mumbai on 01-Apr-2026",
    "BETWEEN Mr. A of the ONE PART AND Mr. B of the OTHER PART.",
    "1. The term of this agreement is eleven months.",
    "2. The monthly rent is Rs. 45,000 payable in advance.",
  ].join("\n");

  it("keeps the unnumbered opening as a citable clause instead of dropping it", () => {
    const { clauses } = segmentClauses(withPreamble);
    expect(clauses.map((c) => c.kind)).toEqual(["preamble", "numbered", "numbered"]);
    expect(clauses[0].id).toBe("PREAMBLE");
    expect(clauses[0].text).toContain("BETWEEN Mr. A");
    expect(clauses[0].index).toBe(0);
  });

  it("does not let the preamble consume a CLAUSE-nn slot", () => {
    const { clauses } = segmentClauses(withPreamble);
    expect(clauses.map((c) => c.id)).toEqual(["PREAMBLE", "CLAUSE-01", "CLAUSE-02"]);
    // The whole point: CLAUSE-02 is the clause the document calls "2".
    expect(clauses[2].label).toBe("2");
  });

  it("omits the preamble when the document opens straight into clause 1", () => {
    const { clauses } = segmentClauses(
      "1. First clause text here.\n2. Second clause text here.",
    );
    expect(clauses.every((c) => c.kind === "numbered")).toBe(true);
  });

  it("ignores a preamble shorter than the minimum worth citing", () => {
    const { clauses } = segmentClauses("Page 1\n1. First clause.\n2. Second clause.");
    expect(clauses).toHaveLength(2);
  });
});

describe("segmentClauses — fallbacks", () => {
  it("falls back to paragraphs when there is no numbering", () => {
    const result = segmentClauses(
      [
        "The parties agree that the tenant shall occupy the premises.",
        "",
        "The landlord shall be responsible for structural repairs.",
      ].join("\n"),
    );
    expect(result.strategy).toBe("paragraphs");
    expect(result.clauses).toHaveLength(2);
    expect(result.clauses[0].label).toBe("¶1");
    expect(result.warnings).toHaveLength(1);
  });

  it("falls back to a single block for a one-paragraph document", () => {
    const result = segmentClauses("A short note with no structure at all.");
    expect(result.strategy).toBe("single");
    expect(result.clauses).toHaveLength(1);
    expect(result.clauses[0].id).toBe("CLAUSE-01");
    expect(result.warnings[0]).toMatch(/could not be split/i);
  });

  it("returns no clauses and warns for empty input", () => {
    const result = segmentClauses("   \n\n  \t ");
    expect(result.clauses).toEqual([]);
    expect(result.warnings[0]).toMatch(/no extractable text/i);
  });
});

describe("segmentClauses — determinism", () => {
  it("gives byte-identical output for the same input", () => {
    const input = "1. First clause text here.\n2. Second clause text here.";
    expect(JSON.stringify(segmentClauses(input))).toBe(JSON.stringify(segmentClauses(input)));
  });

  it("does not depend on the host locale or clock", () => {
    const input = "1. First clause.\n2. Second clause.";
    const before = segmentClauses(input);
    expect(before).toEqual(segmentClauses(input));
  });
});

describe("clauseIdSet", () => {
  it("contains exactly the ids the segmenter produced", () => {
    const { clauses } = segmentClauses("1. Alpha clause.\n2. Beta clause.");
    expect(clauseIdSet(clauses)).toEqual(new Set(["CLAUSE-01", "CLAUSE-02"]));
  });
});
