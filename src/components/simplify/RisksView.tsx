"use client";

import type { Risk, RiskSeverity } from "@/lib/summary/risks";
import { SEVERITY_LABEL } from "@/lib/summary/risks";
import { Cn } from "@/components/simplify/classNames";
import { ClauseChip } from "@/components/simplify/ClauseChip";

const SEVERITY_BLURB: Record<RiskSeverity, string> = {
  critical: "Could cost you the premises, the deposit, or your right to be heard.",
  high: "Significant money, or a right you would reasonably expect to have.",
  medium: "A real but recoverable cost or restriction.",
  low: "A formality, or an inconvenience if things go wrong.",
};

export function RisksView({
  risks,
  clauses,
  onJump,
  highlighted,
}: {
  risks: readonly Risk[];
  clauses: Map<string, { id: string; label: string; kind: string; text: string }>;
  onJump: (clauseId: string) => void;
  highlighted: string | null;
}) {
  return (
    <div className="stack-lg">
      {risks.map((risk, position) => (
        <article
          className={Cn("card risk-card", `severity-${risk.severity}`)}
          key={`${risk.title}-${position}`}
        >
          <div className="risk-head">
            <span className={Cn("severity-badge", `severity-${risk.severity}`)}>
              {SEVERITY_LABEL[risk.severity]}
            </span>
            <h3>{risk.title}</h3>
          </div>
          <p className="risk-body">{risk.explanation}</p>
          <div className="chip-row">
            {risk.clauseIds.map((clauseId) => (
              <ClauseChip
                key={clauseId}
                clauseId={clauseId}
                clauses={clauses}
                onJump={onJump}
                active={highlighted === clauseId}
              />
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Severity is the model's judgement, not a legal assessment, so it is labelled
 * as such rather than presented as a fact about the document.
 */
export function SeverityLegend({ counts }: { counts: Record<RiskSeverity, number> }) {
  const levels: RiskSeverity[] = ["critical", "high", "medium", "low"];
  const present = levels.filter((level) => counts[level] > 0);
  if (present.length === 0) return null;

  return (
    <div className="severity-legend">
      {present.map((level) => (
        <span key={level} className="severity-legend-item">
          <span className={Cn("severity-dot", `severity-${level}`)} aria-hidden="true" />
          <strong>{counts[level]}</strong> {SEVERITY_LABEL[level].toLowerCase()}
          <span className="muted"> — {SEVERITY_BLURB[level]}</span>
        </span>
      ))}
    </div>
  );
}
