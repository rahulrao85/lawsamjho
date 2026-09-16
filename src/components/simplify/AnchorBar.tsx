"use client";

import { computeDeadline, isValidIsoDate } from "@/lib/deadlines";
import type { DeadlineSpec } from "@/lib/deadlines";

/**
 * The anchor-date control.
 *
 * Extracted so obligations, key dates and the brief all read and write the same
 * value. They used to hold their own, which meant setting a date on one panel
 * and finding it reset on the next -- and worse, it would have meant the brief
 * quoting deadlines counted from a date the user never chose.
 */
export function AnchorBar({
  anchorDate,
  onChange,
  label,
  helpId,
  noun,
  datable,
  total,
}: {
  anchorDate: string;
  onChange: (value: string) => void;
  label: string;
  helpId: string;
  /** "deadline" or "date" -- only used for the count sentence. */
  noun: string;
  datable: number;
  total: number;
}) {
  const valid = isValidIsoDate(anchorDate);

  return (
    <div className="anchor-bar">
      <label className="anchor-field">
        <span className="anchor-label">{label}</span>
        <input
          type="date"
          value={anchorDate}
          onChange={(event) => onChange(event.target.value)}
          aria-describedby={helpId}
        />
      </label>
      <p className="muted anchor-help" id={helpId}>
        Usually the date the agreement starts or is signed. The document’s own words are
        always shown — this only works out the calendar date, which is arithmetic rather
        than a judgement about the document.
        {valid && total > 0
          ? ` ${datable} of ${total} ${noun}${total === 1 ? "" : "s"} can be worked out from it.`
          : ""}
      </p>
    </div>
  );
}

/** How many of these deadlines the arithmetic can actually place. */
export function countDatable(specs: readonly DeadlineSpec[], anchorDate: string): number {
  if (!isValidIsoDate(anchorDate)) return 0;
  return specs.filter((spec) => computeDeadline(anchorDate, spec) !== null).length;
}
