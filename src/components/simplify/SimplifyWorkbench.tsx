"use client";

import { useCallback, useId, useRef, useState } from "react";
import type { SimplifyErrorResponse, SimplifySuccessResponse } from "@/lib/api-contract";
import { RENT_AGREEMENT_LABEL, RENT_AGREEMENT_TEXT } from "@/lib/samples/rent-agreement";
import { MAX_UPLOAD_LABEL, fileExtension } from "@/lib/upload";
import { Cn } from "@/components/simplify/classNames";
import { ResultsView } from "@/components/simplify/ResultsView";
import type { AnalysisPanel } from "@/components/simplify/panels";

type State =
  | { kind: "idle" }
  | { kind: "working"; label: string }
  | { kind: "done"; data: SimplifySuccessResponse }
  | { kind: "failed"; message: string; detail?: string };

const ACCEPTED_EXTENSIONS = ["pdf", "txt", "text", "md", "markdown"];

export function SimplifyWorkbench({ initialPanel }: { initialPanel: AnalysisPanel }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const run = useCallback(async (body: FormData | string, label: string) => {
    setLocalError(null);
    setState({ kind: "working", label });

    try {
      const response = await fetch("/api/simplify", {
        method: "POST",
        body,
        headers:
          typeof body === "string" ? { "content-type": "application/json" } : undefined,
      });

      const payload: unknown = await response.json();

      if (!response.ok) {
        const failure = payload as SimplifyErrorResponse;
        setState({
          kind: "failed",
          message: failure.error?.message ?? "The document could not be analysed.",
          detail: failure.error?.detail,
        });
        return;
      }

      setState({ kind: "done", data: payload as SimplifySuccessResponse });
    } catch {
      setState({
        kind: "failed",
        message: "The request could not be completed. Check your connection and try again.",
      });
    }
  }, []);

  const submitFile = useCallback(
    (file: File) => {
      const extension = fileExtension(file.name);
      if (!ACCEPTED_EXTENSIONS.includes(extension)) {
        setLocalError(
          `“${file.name}” is not a supported file. Use a PDF or a plain-text document (.txt, .md).`,
        );
        setState({ kind: "idle" });
        return;
      }

      const form = new FormData();
      form.append("document", file);
      void run(form, `Reading ${file.name}…`);
    },
    [run],
  );

  const working = state.kind === "working";

  return (
    <div className="stack-lg">
      <section className="card upload-card" aria-labelledby="upload-heading">
        <h2 id="upload-heading">Upload a document</h2>
        <p className="muted">
          PDF or plain text, up to {MAX_UPLOAD_LABEL}. Text-based PDFs only — a scanned
          image of a contract cannot be read yet.
        </p>

        <div
          className={Cn("dropzone", dragActive && "is-active", working && "is-busy")}
          onDragOver={(event) => {
            event.preventDefault();
            if (!working) setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragActive(false);
            if (working) return;
            const file = event.dataTransfer.files?.[0];
            if (file) submitFile(file);
          }}
        >
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            className="visually-hidden"
            accept=".pdf,.txt,.text,.md,.markdown,application/pdf,text/plain,text/markdown"
            disabled={working}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) submitFile(file);
              event.target.value = "";
            }}
          />

          <p className="dropzone-hint">Drag a document here, or</p>

          <div className="dropzone-actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={working}
              onClick={() => inputRef.current?.click()}
            >
              Choose a file
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={working}
              onClick={() =>
                void run(
                  JSON.stringify({
                    text: RENT_AGREEMENT_TEXT,
                    filename: "rent-agreement.txt",
                  }),
                  `Analysing the ${RENT_AGREEMENT_LABEL.toLowerCase()}…`,
                )
              }
            >
              Use the {RENT_AGREEMENT_LABEL.toLowerCase()}
            </button>
          </div>
        </div>

        {localError && (
          <p className="inline-error" role="alert">
            {localError}
          </p>
        )}

        {working && (
          <p className="working" role="status">
            <span className="spinner" aria-hidden="true" />
            {state.label}
          </p>
        )}
      </section>

      {state.kind === "failed" && (
        <section className="card failure-card" role="alert">
          <h2>That did not work</h2>
          <p>{state.message}</p>
          {state.detail && <p className="muted mono">{state.detail}</p>}
          <button type="button" className="btn btn-secondary" onClick={() => setState({ kind: "idle" })}>
            Try another document
          </button>
        </section>
      )}

      {state.kind === "done" && (
        <ResultsView data={state.data} initialPanel={initialPanel} />
      )}
    </div>
  );
}
