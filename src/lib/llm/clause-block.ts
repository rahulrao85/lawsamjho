import type { Clause } from "@/lib/segment";

/**
 * Renders the segmented clauses as the delimited block every prompt embeds.
 *
 * Shared by the summary and the Q&A so both present the document to the model
 * identically -- and, more importantly, so the delimiters that mark the block
 * as data are written in one place rather than two.
 */

export const CLAUSE_BLOCK_OPEN = "<<<CLAUSES";
export const CLAUSE_BLOCK_CLOSE = "CLAUSES>>>";

export function buildClauseBlock(
  clauses: readonly Clause[],
  maxChars: number,
): { block: string; truncated: boolean } {
  const parts: string[] = [];
  let length = 0;
  let truncated = false;

  for (const clause of clauses) {
    const heading =
      clause.kind === "preamble"
        ? `${clause.id} (the unnumbered opening of the document)`
        : `${clause.id} (numbered "${clause.label}" in the document)`;
    const part = `${heading}:\n${clause.text}`;

    if (length + part.length > maxChars) {
      truncated = true;
      break;
    }

    parts.push(part);
    length += part.length;
  }

  return { block: parts.join("\n\n"), truncated };
}

/** Wraps the block in its delimiters, with a line the model cannot mistake for content. */
export function wrapClauseBlock(block: string): string {
  return `${CLAUSE_BLOCK_OPEN}\n${block}\n${CLAUSE_BLOCK_CLOSE}`;
}
