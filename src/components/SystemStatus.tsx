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

/**
 * A 429 from the shared limiter is not a health body -- it is the common
 * `{ error: {...} }` shape, with no `config` or `models`, and returning it as
 * "loaded" would make the render below throw on `data.models`. The 503
 * "unavailable"/"misconfigured" bodies *are* health bodies (they always carry
 * config + models), so this checks the shape rather than `response.ok`.
 */
function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<HealthResponse>;
  return (
    typeof candidate.status === "string" &&
    typeof candidate.config === "object" &&
    candidate.config !== null &&
    Array.isArray(candidate.models)
  );
}

/** Module scope so the effect body itself never calls setState synchronously. */
async function fetchHealth(): Promise<State> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data: unknown = await response.json();

    if (!isHealthResponse(data)) {
      return {
        kind: "error",
        message:
          response.status === 429
            ? "Runtime check was throttled. Try again shortly."
            : "The runtime check returned an unexpected response.",
      };
    }

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
