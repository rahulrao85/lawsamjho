"use client";

import type { KeyDate } from "@/lib/summary/risks";
import { ClauseChip } from "@/components/simplify/ClauseChip";
import { DeadlineBlock } from "@/components/simplify/DeadlineBlock";
import { AnchorBar, countDatable } from "@/components/simplify/AnchorBar";

/**
 * Dates the document fixes for itself: the end of the term, the end of a
 * lock-in. Not duties, so they are listed apart from the obligations -- but they
 * go through exactly the same quote gate and the same arithmetic, and share the
 * same anchor date.
 */
export function KeyDatesView({
  keyDates,
  clauses,
  onJump,
  highlighted,
  anchorDate,
  onAnchorDateChange,
}: {
  keyDates: readonly KeyDate[];
  clauses: Map<string, { id: string; label: string; kind: string; text: string }>;
  onJump: (clauseId: string) => void;
  highlighted: string | null;
  anchorDate: string;
  onAnchorDateChange: (value: string) => void;
}) {
  const datable = countDatable(
    keyDates.map((entry) => entry.deadline),
    anchorDate,
  );

  return (
    <div className="stack-lg">
      <AnchorBar
        anchorDate={anchorDate}
        onChange={onAnchorDateChange}
        label="Count dates from"
        helpId="keydates-help"
        noun="date"
        datable={datable}
        total={keyDates.length}
      />

      <ul className="keydate-list">
        {keyDates.map((entry, position) => (
          <li className="card keydate-card" key={`${entry.label}-${position}`}>
            <h3>{entry.label}</h3>
            <DeadlineBlock deadline={entry.deadline} anchorDate={anchorDate} />
            <div className="chip-row">
              {entry.clauseIds.map((clauseId) => (
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
      </ul>

      <p className="muted small-print">
        Worked out from the anchor date you enter, by arithmetic rather than by the
        model. A period of N months starting on a date runs to the day before the same
        date N months later — so a term of eleven months commencing 01-Apr-2026 is shown
        as ending 01-Mar-2027, whose last full day is 28-Feb-2027. If the document also
        states an end date in words, the two should agree; check them against each other.
      </p>
    </div>
  );
}
