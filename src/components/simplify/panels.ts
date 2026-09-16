/** The views of one analysis, and the only place they are named. */
export type AnalysisPanel =
  | "summary"
  | "risks"
  | "obligations"
  | "dates"
  | "ask"
  | "brief"
  | "clauses";

const PANELS: readonly AnalysisPanel[] = [
  "summary",
  "risks",
  "obligations",
  "dates",
  "ask",
  "brief",
  "clauses",
];

/** Anything unrecognised falls back to the summary rather than erroring. */
export function normalisePanel(value: unknown): AnalysisPanel {
  return typeof value === "string" && (PANELS as readonly string[]).includes(value)
    ? (value as AnalysisPanel)
    : "summary";
}
