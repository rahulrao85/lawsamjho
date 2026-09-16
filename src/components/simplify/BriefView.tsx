"use client";

import { useCallback, useMemo, useState } from "react";
import type { SimplifySuccessResponse } from "@/lib/api-contract";
import { buildBrief, briefToMarkdown } from "@/lib/brief/brief";
import { formatDisplayDate } from "@/lib/deadlines";
import { QUESTION_TARGET } from "@/lib/brief/questions";
import { ClauseChip } from "@/components/simplify/ClauseChip";

/**
 * The lawyer-prep brief.
 *
 * One artifact to take to a lawyer: the situation, what the document requires,
 * where it works against the reader, the dates that matter, and five questions.
 *
 * It is assembled in the browser from data already on the page, so opening it
 * costs nothing and cannot introduce a claim that has not already been through
 * the gates. Three ways out: print/save as PDF, copy as text, or download
 * Markdown -- all of them carrying the disclaimer and the method note with them,
 * because the brief is meant to leave this app.
 */

type ClauseLookup = Map<string, { id: string; label: string; kind: string; text: string }>;

function IsoDate(iso: string): string {
  return formatDisplayDate(iso);
}

export function BriefView({
  data,
  anchorDate,
  clauseIndex,
  onJump,
  highlighted,
}: {
  data: SimplifySuccessResponse;
  anchorDate: string;
  clauseIndex: ClauseLookup;
  onJump: (clauseId: string) => void;
  highlighted: string | null;
}) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");

  const brief = useMemo(
    () =>
      buildBrief({
        filename: data.document.filename,
        pageCount: data.document.pageCount,
        clauseCount: data.document.clauseCount,
        clauses: data.clauses,
        summary: data.summary,
        risks: data.risks,
        obligations: data.obligations,
        keyDates: data.keyDates,
        citations: data.citations,
        analysis: data.analysis,
        generation: data.generation,
        anchorDate,
      }),
    [data, anchorDate],
  );

  const markdown = useMemo(() => briefToMarkdown(brief), [brief]);

  const download = useCallback(() => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `lawyer-brief-${data.document.filename.replace(/\.[^.]+$/, "")}.md`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, [markdown, data.document.filename]);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied("done");
    } catch {
      // Clipboard access can be denied; the download button still works, so say
      // so instead of failing silently.
      setCopied("failed");
    }
    setTimeout(() => setCopied("idle"), 2500);
  }, [markdown]);

  const chips = (clauseIds: readonly string[]) => (
    <div className="chip-row no-print">
      {clauseIds.map((clauseId) => (
        <ClauseChip
          key={clauseId}
          clauseId={clauseId}
          clauses={clauseIndex}
          onJump={onJump}
          active={highlighted === clauseId}
        />
      ))}
    </div>
  );

  return (
    <div className="stack-lg">
      <div className="brief-actions no-print">
        <button type="button" className="btn btn-primary" onClick={() => window.print()}>
          Print / save as PDF
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void copy()}>
          {copied === "done" ? "Copied" : copied === "failed" ? "Copy blocked by browser" : "Copy as text"}
        </button>
        <button type="button" className="btn btn-secondary" onClick={download}>
          Download Markdown
        </button>
      </div>

      <article className="card brief" id="brief">
        <header className="brief-header">
          <span className="tag no-print">Lawyer-prep brief</span>
          <h2>{brief.title}</h2>
          <p className="muted">
            Prepared with LawSamjho on {IsoDate(
              `${brief.generatedAt.getFullYear()}-${String(brief.generatedAt.getMonth() + 1).padStart(2, "0")}-${String(brief.generatedAt.getDate()).padStart(2, "0")}`,
            )}{" "}
            from <strong>{brief.document.filename}</strong>
            {brief.document.pageCount ? ` (${brief.document.pageCount} pages)` : ""},{" "}
            {brief.document.clauseCount} clauses.
          </p>
        </header>

        <p className="notice">
          This is a summary of a document, prepared to help a conversation with a qualified
          lawyer. It is <strong>not legal advice</strong> and it is not a substitute for
          one. Every point below is tied to the clause it came from so it can be checked.
        </p>

        {brief.document.anchorDate && (
          <p className="muted brief-line">
            Deadlines below are counted from <strong>{IsoDate(brief.document.anchorDate)}</strong>, the
            starting date entered. If the agreement starts on a different date, change it on the
            Obligations or Key dates panel and this brief will use it.
          </p>
        )}

        <section>
          <h3 className="brief-heading">1. Situation in short</h3>
          <p className="brief-headline">{brief.document.headline}</p>
          <ul className="brief-list">
            {brief.situation.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
        </section>

        <section>
          <h3 className="brief-heading">2. What this document requires</h3>
          {brief.obligations.length === 0 ? (
            <p className="muted">No obligations were identified.</p>
          ) : (
            <ul className="brief-list">
              {brief.obligations.map((item, position) => (
                <li key={`${item.body}-${position}`}>
                  <strong>{item.title}</strong> — {item.body}
                  {item.quote && <div className="brief-quote">“{item.quote}”</div>}
                  {item.date ? (
                    <div className="brief-date">Date: {item.date}</div>
                  ) : item.dateNote ? (
                    <div className="muted brief-line">No date: {item.dateNote}.</div>
                  ) : null}
                  {chips(item.clauseIds)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="brief-heading">3. Where it works against the reader</h3>
          {brief.risks.length === 0 ? (
            <p className="muted">No risks were identified.</p>
          ) : (
            <ul className="brief-list">
              {brief.risks.map((item, position) => (
                <li key={`${item.title}-${position}`}>
                  <span className={`severity-badge severity-${item.severity?.toLowerCase()}`}>
                    {item.severity}
                  </span>{" "}
                  <strong>{item.title}</strong>
                  <div>{item.body}</div>
                  {chips(item.clauseIds)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="brief-heading">4. Dates to diarise</h3>
          {brief.keyDates.length === 0 ? (
            <p className="muted">The document does not fix any dates of its own.</p>
          ) : (
            <ul className="brief-list">
              {brief.keyDates.map((item, position) => (
                <li key={`${item.title}-${position}`}>
                  <strong>{item.title}</strong> — {item.date ?? item.body}
                  {item.quote && <span className="brief-quote"> “{item.quote}”</span>}
                  {chips(item.clauseIds)}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3 className="brief-heading">5. Questions to ask a lawyer</h3>
          <ol className="brief-questions">
            {brief.questions.map((question, position) => (
              <li key={`${question.question}-${position}`}>
                {question.question}
                {question.clauseIds.length > 0 && (
                  <span className="muted brief-line"> ({question.clauseIds.length} clause reference)</span>
                )}
                {chips(question.clauseIds)}
              </li>
            ))}
          </ol>
          {brief.questions.length < QUESTION_TARGET && (
            <p className="muted brief-line">
              Fewer than {QUESTION_TARGET} questions: this document gave {brief.questions.length} worth
              asking. Nothing was padded out to reach five.
            </p>
          )}
          {brief.moreQuestionsAvailable > 0 && (
            <p className="muted brief-line">
              {brief.moreQuestionsAvailable} further question
              {brief.moreQuestionsAvailable === 1 ? "" : "s"} were left out to keep this list to{" "}
              {QUESTION_TARGET}.
            </p>
          )}
        </section>

        <section className="brief-method">
          <h3 className="brief-heading">How this was prepared</h3>
          <p className="muted brief-line">
            The document was split into {brief.document.clauseCount} numbered clauses by a
            deterministic step, and every claim was checked against those clause IDs before
            being shown: <strong>{brief.verification.citationsVerified}</strong> citation
            {brief.verification.citationsVerified === 1 ? "" : "s"} verified,{" "}
            <strong>{brief.verification.citationsDiscarded}</strong> discarded.
          </p>
          {brief.verification.unverifiedDeadlineQuotes > 0 && (
            <p className="muted brief-line">
              {brief.verification.unverifiedDeadlineQuotes} deadline(s) were reported that could
              not be found in the cited clause; those are not shown and no dates were calculated
              from them.
            </p>
          )}
          <p className="muted brief-line">
            Deadlines are worked out by date arithmetic in the application, not by the language
            model. Model: {brief.verification.model}
            {brief.verification.usedFallback ? " (fallback tier)" : ""}.
          </p>
        </section>
      </article>
    </div>
  );
}
