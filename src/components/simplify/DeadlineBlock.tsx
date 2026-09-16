"use client";

import { computeDeadline, describeOffset, isValidIsoDate } from "@/lib/deadlines";
import type { DeadlineSpec } from "@/lib/deadlines";

/**
 * Renders one deadline: the document's own words, and — when the arithmetic can
 * place it — the calendar date.
 *
 * Extracted so obligations and key dates cannot drift apart in how they explain
 * themselves. The three "no date" cases are worded differently on purpose:
 * "the clause sets no deadline", "it repeats", and "it depends on an event" are
 * three different facts, and "the model claimed one we could not find" is a
 * fourth. Collapsing them into one message would be easier and less honest.
 */
export function DeadlineBlock({
  deadline,
  anchorDate,
  unverified = false,
}: {
  deadline: DeadlineSpec;
  anchorDate: string;
  unverified?: boolean;
}) {
  if (unverified) {
    return (
      <p className="deadline deadline-warning">
        A deadline was reported here, but its words could not be found in the clause it
        cites — so it is not shown and no date is calculated from it.
      </p>
    );
  }

  if (deadline.quotedText === "") {
    return <p className="deadline muted">No deadline stated in this clause.</p>;
  }

  const computed = isValidIsoDate(anchorDate) ? computeDeadline(anchorDate, deadline) : null;
  const offset = describeOffset(deadline);

  return (
    <div className="deadline">
      <p className="deadline-quote">“{deadline.quotedText}”</p>

      {computed ? (
        <p className="deadline-computed">
          <span className="deadline-date">{computed.display}</span>
          {offset ? <span className="muted"> — {offset} the anchor date</span> : null}
        </p>
      ) : !isValidIsoDate(anchorDate) ? (
        <p className="muted">Enter an anchor date to work out the calendar date.</p>
      ) : deadline.basis === "recurring" ? (
        <p className="muted">
          This one repeats, so there is no single calendar date to calculate — the
          document’s own words above say when it falls due.
        </p>
      ) : deadline.basis === "event" ? (
        <p className="muted">
          Runs from something that has not happened yet, so no calendar date is
          calculated from the agreement date — only the document’s own words are shown.
        </p>
      ) : (
        <p className="muted">
          Stated in a form we could not turn into a calendar date, so only the
          document’s own words are shown.
        </p>
      )}
    </div>
  );
}
