"use client";

import { useCallback, useRef, useState } from "react";
import type { AskErrorResponse, AskSuccessResponse } from "@/lib/api-contract";
import type { Clause } from "@/lib/segment";
import { Cn } from "@/components/simplify/classNames";
import { ClauseChip } from "@/components/simplify/ClauseChip";

/**
 * Grounded Q&A.
 *
 * The clauses are already in the browser from the analysis, so a question is a
 * small POST rather than a re-upload. Exchanges are kept in order so the reader
 * can see what they have already asked, but each question is answered
 * independently from the document -- this is not a conversation, and pretending
 * otherwise would mean the model could carry context the citations do not
 * support.
 */

type Exchange = {
  id: number;
  question: string;
  state:
    | { kind: "pending" }
    | { kind: "answered"; response: AskSuccessResponse }
    | { kind: "error"; message: string; detail?: string };
};

const SUGGESTIONS = [
  "What is the notice period?",
  "How much is the security deposit, and when is it refunded?",
  "Can the landlord enter the flat without my permission?",
  "What happens if I leave before the lock-in ends?",
];

type ClauseLookup = Map<string, { id: string; label: string; kind: string; text: string }>;

export function AskView({
  clauses,
  clauseIndex,
  onJump,
  highlighted,
}: {
  clauses: readonly Clause[];
  clauseIndex: ClauseLookup;
  onJump: (clauseId: string) => void;
  highlighted: string | null;
}) {
  const [question, setQuestion] = useState("");
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const nextId = useRef(1);

  const ask = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (trimmed.length === 0) return;

      const id = nextId.current++;
      setExchanges((current) => [
        ...current,
        { id, question: trimmed, state: { kind: "pending" } },
      ]);
      setQuestion("");

      const settle = (state: Exchange["state"]) =>
        setExchanges((current) =>
          current.map((exchange) => (exchange.id === id ? { ...exchange, state } : exchange)),
        );

      try {
        const response = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: trimmed, clauses }),
        });

        const payload: unknown = await response.json();

        if (!response.ok) {
          const failure = payload as AskErrorResponse;
          settle({
            kind: "error",
            message: failure.error?.message ?? "That question could not be answered.",
            detail: failure.error?.detail,
          });
          return;
        }

        settle({ kind: "answered", response: payload as AskSuccessResponse });
      } catch {
        settle({
          kind: "error",
          message: "The question could not be sent. Check your connection and try again.",
        });
      }
    },
    [clauses],
  );

  const busy = exchanges.some((exchange) => exchange.state.kind === "pending");

  return (
    <div className="stack-lg">
      <form
        className="ask-form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <label className="visually-hidden" htmlFor="ask-question">
          Your question about this document
        </label>
        <input
          id="ask-question"
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask something this document should answer…"
          maxLength={1000}
          autoComplete="off"
        />
        <button type="submit" className="btn btn-primary" disabled={busy || question.trim().length === 0}>
          {busy ? "Asking…" : "Ask"}
        </button>
      </form>

      {exchanges.length === 0 && (
        <div className="ask-suggestions">
          <p className="muted">
            Answers come only from this document. If it does not cover something, it says
            so rather than guessing — and the question itself is treated as a question, not
            as an instruction.
          </p>
          <div className="chip-row">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="clause-chip suggestion-chip"
                onClick={() => void ask(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <ol className="exchange-list">
        {exchanges.map((exchange) => (
          <li className="exchange" key={exchange.id}>
            <p className="exchange-question">{exchange.question}</p>

            {exchange.state.kind === "pending" && (
              <p className="working" role="status">
                <span className="spinner" aria-hidden="true" />
                Reading the clauses…
              </p>
            )}

            {exchange.state.kind === "error" && (
              <div className="exchange-answer exchange-error" role="alert">
                <p>{exchange.state.message}</p>
                {exchange.state.detail && <p className="muted mono">{exchange.state.detail}</p>}
              </div>
            )}

            {exchange.state.kind === "answered" && (
              <div
                className={Cn(
                  "exchange-answer",
                  exchange.state.response.status === "not-in-document" && "is-unanswerable",
                )}
              >
                <p>{exchange.state.response.answer}</p>

                {exchange.state.response.clauseIds.length > 0 && (
                  <div className="chip-row">
                    {exchange.state.response.clauseIds.map((clauseId) => (
                      <ClauseChip
                        key={clauseId}
                        clauseId={clauseId}
                        clauses={clauseIndex}
                        onJump={onJump}
                        active={highlighted === clauseId}
                      />
                    ))}
                  </div>
                )}

                <p className="muted exchange-meta">
                  {exchange.state.response.status === "not-in-document"
                    ? "Not covered by this document"
                    : `${exchange.state.response.citations.verifiedCount} citation${
                        exchange.state.response.citations.verifiedCount === 1 ? "" : "s"
                      } checked against the clauses`}
                  {exchange.state.response.generation.usedFallback ? " · answered by fallback model" : ""}
                </p>
              </div>
            )}
          </li>
        ))}
      </ol>

      {exchanges.length > 0 && (
        <p className="muted small-print">
          Answers describe what this document says. They are not legal advice, and each one
          is only as good as the clause beside it — check it there.
        </p>
      )}
    </div>
  );
}
