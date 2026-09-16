"use client";

import { useEffect, useState } from "react";

type HealthResponse = {
  status: "ok" | "unavailable" | "misconfigured";
  config: {
    ok: boolean;
    issues: string[];
    model?: string;
    fallbackModel?: string;
  };
  models: { id: string; ok: boolean; latencyMs?: number; error?: string }[];
  answeredBy: string | null;
  checkedAt: string;
};

type State =
  | { kind: "loading" }
  | { kind: "loaded"; data: HealthResponse }
  | { kind: "error"; message: string };

/** Module scope so the effect body itself never calls setState synchronously. */
async function fetchHealth(): Promise<State> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = (await response.json()) as HealthResponse;
    return { kind: "loaded", data };
  } catch {
    return { kind: "error", message: "Could not reach /api/health" };
  }
}

export function SystemStatus() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const answered = state.kind === "loaded" ? state.data.models.find((m) => m.ok) : undefined;
  const isOk = state.kind === "loaded" && state.data.status === "ok";

  return (
    <div className="card status-card">
      <div className="status-head">
        <h2 style={{ margin: 0 }}>Runtime check</h2>
        <span className={`tag${isOk ? "" : " tag-accent"}`}>
          {state.kind === "loading" && "checking"}
          {state.kind === "error" && "unreachable"}
          {state.kind === "loaded" && state.data.status}
        </span>
      </div>

      {state.kind === "loading" && <p className="muted">Calling the model…</p>}

      {state.kind === "error" && <p className="muted">{state.message}</p>}

      {state.kind === "loaded" && (
        <>
          <dl className="status-list">
            <div>
              <dt>Primary model</dt>
              <dd className="mono">{state.data.config.model ?? "—"}</dd>
            </div>
            <div>
              <dt>Fallback tier</dt>
              <dd className="mono">{state.data.config.fallbackModel ?? "—"}</dd>
            </div>
            <div>
              <dt>Answered by</dt>
              <dd className="mono">{state.data.answeredBy ?? "none"}</dd>
            </div>
            <div>
              <dt>Latency</dt>
              <dd className="mono">
                {answered?.latencyMs ? `${answered.latencyMs} ms` : "—"}
              </dd>
            </div>
          </dl>

          {state.data.config.issues.length > 0 && (
            <ul className="issue-list">
              {state.data.config.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setState({ kind: "loading" });
              setAttempt((value) => value + 1);
            }}
          >
            Re-check
          </button>
        </>
      )}
    </div>
  );
}
