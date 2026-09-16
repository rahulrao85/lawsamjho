"use client";

import type { Obligation } from "@/lib/summary/risks";
import { ClauseChip } from "@/components/simplify/ClauseChip";
import { DeadlineBlock } from "@/components/simplify/DeadlineBlock";
import { AnchorBar, countDatable } from "@/components/simplify/AnchorBar";

/**
 * Obligations, with the date arithmetic done in the browser rather than by the
 * model.
 *
 * The server sends the deadline as the document states it plus the offset it
 * describes ("90 days after"). This component turns that into a calendar date
 * using the same pure functions the tests cover, from the shared anchor date.
 */

type ClauseLookup = Map<string, { id: string; label: string; kind: string; text: string }>;

export function ObligationsView({
  obligations,
  clauses,
  onJump,
  highlighted,
  anchorDate,
  onAnchorDateChange,
}: {
  obligations: readonly Obligation[];
  clauses: ClauseLookup;
  onJump: (clauseId: string) => void;
  highlighted: string | null;
  anchorDate: string;
  onAnchorDateChange: (value: string) => void;
}) {
  const datable = countDatable(
    obligations.map((obligation) => obligation.deadline),
    anchorDate,
  );

  return (
    <div className="stack-lg">
      <AnchorBar
        anchorDate={anchorDate}
        onChange={onAnchorDateChange}
        label="Count deadlines from"
        helpId="anchor-help"
        noun="deadline"
        datable={datable}
        total={obligations.length}
      />

      <ol className="obligation-list">
        {obligations.map((obligation, position) => (
          <li className="card obligation-card" key={`${obligation.description}-${position}`}>
            <span className="tag">{obligation.party}</span>
            <p className="obligation-body">{obligation.description}</p>

            <DeadlineBlock
              deadline={obligation.deadline}
              anchorDate={anchorDate}
              unverified={obligation.deadlineUnverified}
            />

            <div className="chip-row">
              {obligation.clauseIds.map((clauseId) => (
                <ClauseChip
                  key={clauseId}
                  clauseId={clauseId}
                  clauses={clauses}
                  onJump={onJump}
                  active={highlighted === clauseId}
                />
              ))}
            </div>
          </li>
        ))}
      </ol>

      <p className="muted small-print">
        Dates are worked out from the anchor date you enter. They are not legal
        deadlines as a court would apply them — check them against the document.
      </p>
    </div>
  );
}
