"use client";

import { Cn } from "@/components/simplify/classNames";

/**
 * The citation chip, extracted so the summary, risks and obligations all render
 * citations identically and jump to the same place.
 *
 * A chip is only ever constructed from an ID that already survived the gate in
 * `verify.ts`, so every chip on screen is guaranteed to resolve to a clause.
 */
export function ClauseChip({
  clauseId,
  clauses,
  onJump,
  active,
}: {
  clauseId: string;
  clauses: Map<string, { id: string; label: string; kind: string; text: string }>;
  onJump: (clauseId: string) => void;
  active: boolean;
}) {
  const clause = clauses.get(clauseId);
  const label = clause ? clause.label : clauseId;
  const isPreamble = clause?.kind === "preamble";

  return (
    <button
      type="button"
      className={Cn("clause-chip", active && "is-active")}
      onClick={() => onJump(clauseId)}
      title={
        clause
          ? `${isPreamble ? "Preamble" : `Clause ${label}`}: ${clause.text.slice(0, 160)}${clause.text.length > 160 ? "…" : ""}`
          : clauseId
      }
    >
      {isPreamble ? "Preamble" : `Clause ${label}`}
    </button>
  );
}
