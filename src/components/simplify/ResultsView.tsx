"use client";

import { useCallback, useMemo, useState } from "react";
import type { SimplifySuccessResponse } from "@/lib/api-contract";
import { todayIsoDate } from "@/lib/deadlines";
import { countBySeverity } from "@/lib/summary/risks";
import { Cn } from "@/components/simplify/classNames";
import { ClauseChip } from "@/components/simplify/ClauseChip";
import { RisksView, SeverityLegend } from "@/components/simplify/RisksView";
import { ObligationsView } from "@/components/simplify/ObligationsView";
import { KeyDatesView } from "@/components/simplify/KeyDatesView";
import { AskView } from "@/components/simplify/AskView";
import { BriefView } from "@/components/simplify/BriefView";
import type { AnalysisPanel } from "@/components/simplify/panels";

type Panel = AnalysisPanel;

export function ResultsView({
  data,
  initialPanel = "summary",
}: {
  data: SimplifySuccessResponse;
  initialPanel?: Panel;
}) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(initialPanel);
  /**
   * One anchor date for the whole analysis. Obligations, key dates and the
   * brief all read it, so they cannot disagree about what a deadline resolves
   * to -- and a reader who sets it once does not have to set it again.
   */
  const [anchorDate, setAnchorDate] = useState(() => todayIsoDate());

  const clauseIndex = useMemo(
    () => new Map(data.clauses.map((clause) => [clause.id, clause])),
    [data.clauses],
  );

  // Jumping from a chip always lands on the clause list, whichever panel the
  // citation was clicked from.
  const jump = useCallback((clauseId: string) => {
    setPanel("clauses");
    setHighlighted(clauseId);
    requestAnimationFrame(() => {
      document
        .getElementById(`clause-${clauseId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, []);

  const { citations, generation, analysis } = data;
  const severityCounts = useMemo(() => countBySeverity(data.risks), [data.risks]);
  const nothingDiscarded = citations.discardedCount === 0 && citations.droppedItemCount === 0;

  const panels: { id: Panel; label: string; count: number | null }[] = [
    { id: "summary", label: "Summary", count: data.summary.sentences.length },
    { id: "risks", label: "Risks", count: data.risks.length },
    { id: "obligations", label: "Obligations", count: data.obligations.length },
    { id: "dates", label: "Key dates", count: data.keyDates.length },
    { id: "ask", label: "Ask", count: null },
    { id: "brief", label: "Lawyer brief", count: null },
    { id: "clauses", label: "Clauses", count: data.clauses.length },
  ];

  return (
    <div className="stack-lg">
      <section className="card results-header" aria-labelledby="overview-heading">
        <div className="stack">
          <div className="results-topline">
            <span className="tag">{data.summary.documentType}</span>
            <span className="tag tag-accent">
              {data.segmentation.strategy === "numbered"
                ? "numbered clauses"
                : data.segmentation.strategy}
            </span>
          </div>

          <h2 id="overview-heading" className="headline">
            {data.summary.headline}
          </h2>

          <dl className="status-list">
            <div>
              <dt>Document</dt>
              <dd className="mono">{data.document.filename}</dd>
            </div>
            <div>
              <dt>{data.document.pageCount ? "Pages" : "Characters"}</dt>
              <dd className="mono">
                {data.document.pageCount ?? data.document.charCount.toLocaleString("en-IN")}
              </dd>
            </div>
            <div>
              <dt>Clauses found</dt>
              <dd className="mono">{data.document.clauseCount}</dd>
            </div>
            <div>
              <dt>Answered by</dt>
              <dd className="mono">
                {generation.model}
                {generation.usedFallback ? " (fallback)" : ""}
              </dd>
            </div>
          </dl>
        </div>

        <div className={Cn("citation-report", nothingDiscarded ? "is-clean" : "is-correcting")}>
          <strong>{citations.verifiedCount}</strong> citations checked against the document
          {citations.discardedCount > 0 ? (
            <>
              {" · "}
              <strong>{citations.discardedCount}</strong> invented reference
              {citations.discardedCount === 1 ? "" : "s"} discarded
              {citations.inventedIds.length > 0 ? ` (${citations.inventedIds.join(", ")})` : ""}
            </>
          ) : (
            " · nothing had to be discarded"
          )}
          {citations.droppedItemCount > 0 ? (
            <>
              {" · "}
              <strong>{citations.droppedItemCount}</strong> unsupported statement
              {citations.droppedItemCount === 1 ? "" : "s"} removed
            </>
          ) : null}
        </div>
      </section>

      {[...data.extractionWarnings, ...data.segmentation.warnings].map((warning) => (
        <p className="notice" key={warning}>
          {warning}
        </p>
      ))}

      {analysis.unverifiedDeadlineQuotes > 0 && (
        <p className="notice">
          For <strong>{analysis.unverifiedDeadlineQuotes}</strong> obligation
          {analysis.unverifiedDeadlineQuotes === 1 ? "" : "s"}, a deadline was reported
          that could not be found in the cited clause. Those deadlines are not shown and
          no dates were calculated from them.
        </p>
      )}

      {generation.truncated && (
        <p className="notice">
          This document was longer than one pass allows. The analysis covers only its
          earlier clauses — later clauses were not analysed.
        </p>
      )}

      <nav className="panel-tabs no-print" aria-label="Analysis sections">
        {panels.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={Cn("panel-tab", panel === entry.id && "is-active")}
            aria-current={panel === entry.id ? "true" : undefined}
            onClick={() => setPanel(entry.id)}
          >
            {entry.label}
            {entry.count !== null && <span className="panel-tab-count">{entry.count}</span>}
          </button>
        ))}
      </nav>

      {panel === "summary" && (
        <section className="card" aria-labelledby="summary-heading">
          <h2 id="summary-heading">In plain language</h2>
          <ol className="summary-sentences">
            {data.summary.sentences.map((sentence) => (
              <li key={sentence.text}>
                <p>{sentence.text}</p>
                <div className="chip-row">
                  {sentence.clauseIds.map((clauseId) => (
                    <ClauseChip
                      key={clauseId}
                      clauseId={clauseId}
                      clauses={clauseIndex}
                      onJump={jump}
                      active={highlighted === clauseId}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ol>

          <h2 className="subheading">Key terms</h2>
          <ul className="term-list">
            {data.summary.keyTerms.map((term) => (
              <li key={term.term}>
                <h3>{term.term}</h3>
                <p>{term.plainMeaning}</p>
                <div className="chip-row">
                  {term.clauseIds.map((clauseId) => (
                    <ClauseChip
                      key={clauseId}
                      clauseId={clauseId}
                      clauses={clauseIndex}
                      onJump={jump}
                      active={highlighted === clauseId}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {panel === "risks" && (
        <section className="stack-lg" aria-labelledby="risks-heading">
          <div className="card">
            <h2 id="risks-heading">Where this document works against you</h2>
            <p className="muted">
              Severity is how much a clause could cost you <em>if it is used</em>, judged
              only from what this document provides. It is an estimate, not a legal
              assessment.
            </p>
            <SeverityLegend counts={severityCounts} />
          </div>
          <RisksView
            risks={data.risks}
            clauses={clauseIndex}
            onJump={jump}
            highlighted={highlighted}
          />
        </section>
      )}

      {panel === "obligations" && (
        <section className="card" aria-labelledby="obligations-heading">
          <h2 id="obligations-heading">What you have to do, and by when</h2>
          <p className="muted">
            Each obligation shows the deadline in the document’s own words. Calendar
            dates are worked out from the anchor date below — by arithmetic, not by the
            model.
          </p>
          <ObligationsView
            obligations={data.obligations}
            clauses={clauseIndex}
            onJump={jump}
            highlighted={highlighted}
            anchorDate={anchorDate}
            onAnchorDateChange={setAnchorDate}
          />
        </section>
      )}

      {panel === "dates" && (
        <section className="card" aria-labelledby="dates-heading">
          <h2 id="dates-heading">The dates this document fixes</h2>
          <p className="muted">
            The end of the term, the end of the lock-in, and anything else the document
            dates for itself. Each shows the document’s own words beside the calendar
            date worked out from the anchor date you choose.
          </p>
          <KeyDatesView
            keyDates={data.keyDates}
            clauses={clauseIndex}
            onJump={jump}
            highlighted={highlighted}
            anchorDate={anchorDate}
            onAnchorDateChange={setAnchorDate}
          />
        </section>
      )}

      {panel === "brief" && (
        <BriefView
          data={data}
          anchorDate={anchorDate}
          clauseIndex={clauseIndex}
          onJump={jump}
          highlighted={highlighted}
        />
      )}

      {panel === "ask" && (
        <section className="card" aria-labelledby="ask-heading">
          <h2 id="ask-heading">Ask about this document</h2>
          <p className="muted">
            Answers are drawn only from these clauses and cite the ones they came from. If
            the document does not answer a question, it says so instead of guessing.
          </p>
          <AskView
            clauses={data.clauses}
            clauseIndex={clauseIndex}
            onJump={jump}
            highlighted={highlighted}
          />
        </section>
      )}

      {panel === "clauses" && (
        <section className="card" aria-labelledby="clauses-heading">
          <h2 id="clauses-heading">The document, clause by clause</h2>
          <p className="muted">
            This is the text every claim above was drawn from, split by the segmenter.
            Check any claim against the clause it cites.
          </p>
          <ol className="clause-list">
            {data.clauses.map((clause) => (
              <li
                key={clause.id}
                id={`clause-${clause.id}`}
                className={Cn("clause", highlighted === clause.id && "is-highlighted")}
              >
                <div className="clause-head">
                  <span className="clause-label">
                    {clause.kind === "preamble" ? "Preamble" : clause.label}
                  </span>
                  <span className="clause-id mono">{clause.id}</span>
                </div>
                <p className="clause-text">{clause.text}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
