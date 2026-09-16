import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFromBytes } from "@/lib/pdf/extract";
import { RENT_AGREEMENT_TEXT } from "@/lib/samples/rent-agreement";
import { segmentClauses } from "@/lib/segment";

/**
 * The demo document is generated from samples/rent-agreement.txt by
 * `npm run samples`. These tests exist because the sample is load-bearing:
 * if the .pdf stops yielding its clause markers, the live demo breaks in front
 * of an audience rather than in CI.
 */

const PROJECT_ROOT = process.cwd();
const TXT_PATH = path.join(PROJECT_ROOT, "samples", "rent-agreement.txt");
const PDF_PATH = path.join(PROJECT_ROOT, "samples", "rent-agreement.pdf");

describe("bundled sample document", () => {
  it("keeps the embedded copy identical to the .txt source of truth", async () => {
    const source = await readFile(TXT_PATH, "utf8");
    // The generator trims the trailing newline; compare on content, not bytes.
    expect(RENT_AGREEMENT_TEXT.trimEnd()).toBe(source.trimEnd());
  });

  it("segments the embedded text into a preamble plus 18 numbered clauses", () => {
    const result = segmentClauses(RENT_AGREEMENT_TEXT);

    expect(result.strategy).toBe("numbered");
    expect(result.warnings).toEqual([]);

    const numbered = result.clauses.filter((clause) => clause.kind === "numbered");
    expect(numbered).toHaveLength(18);
    expect(numbered.map((clause) => clause.label)).toEqual(
      Array.from({ length: 18 }, (_unused, index) => String(index + 1)),
    );

    const preamble = result.clauses.find((clause) => clause.kind === "preamble");
    expect(preamble?.id).toBe("PREAMBLE");
    expect(preamble?.text).toContain("the Licensor");
  });

  it("produces a PDF that still yields every clause marker when text is extracted", async () => {
    const bytes = new Uint8Array(await readFile(PDF_PATH));
    const extracted = await extractFromBytes(bytes, "pdf");

    expect(extracted.pageCount).toBeGreaterThan(1);
    expect(extracted.warnings).toEqual([]);

    const result = segmentClauses(extracted.text);
    expect(result.strategy).toBe("numbered");
    expect(result.clauses.filter((clause) => clause.kind === "numbered")).toHaveLength(18);
  });

  it("keeps each clause's substance intact through the PDF round trip", async () => {
    const bytes = new Uint8Array(await readFile(PDF_PATH));
    const extracted = await extractFromBytes(bytes, "pdf");
    const { clauses } = segmentClauses(extracted.text);

    const rent = clauses.find((clause) => clause.label === "2");
    expect(rent?.text).toContain("45,000");
    expect(rent?.text).toContain("seventh day");

    const lockIn = clauses.find((clause) => clause.label === "10");
    expect(lockIn?.text).toContain("six (6) months");
  });
});
