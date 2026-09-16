/**
 * Shared HTTP helpers for the API routes.
 *
 * One error shape everywhere, and never a stack trace or an upstream provider
 * message on the wire. `detail` exists for the coordinator reading logs and for
 * the UI's "what went wrong" panel -- it is scrubbed of anything long enough to
 * be a payload.
 */

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    detail?: string;
  };
};

const MAX_DETAIL_CHARS = 600;

function scrub(detail: string | undefined): string | undefined {
  if (!detail) return undefined;
  const collapsed = detail.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return undefined;
  return collapsed.length > MAX_DETAIL_CHARS
    ? `${collapsed.slice(0, MAX_DETAIL_CHARS)}…`
    : collapsed;
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  detail?: string,
): Response {
  const body: ApiErrorBody = { error: { code, message, detail: scrub(detail) } };
  return Response.json(body, { status });
}

/**
 * 429 with a `Retry-After` the caller can act on rather than a bare refusal.
 * `Retry-After` is in seconds per the spec, so sub-second waits round up to 1
 * rather than to 0 -- "retry after 0 seconds" invites an immediate retry storm.
 */
export function jsonTooManyRequests(retryAfterMs: number, message: string): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return Response.json(
    {
      error: {
        code: "rate_limited",
        message,
        detail: `Try again in about ${seconds} second${seconds === 1 ? "" : "s"}.`,
      },
    } satisfies ApiErrorBody,
    { status: 429, headers: { "retry-after": String(seconds) } },
  );
}

/**
 * Reject an oversized request before the body is buffered into memory.
 * `slack` covers multipart framing overhead on top of the file itself.
 */
export function contentLengthExceeded(request: Request, maxBytes: number, slack = 64_000): boolean {
  const header = request.headers.get("content-length");
  if (!header) return false;
  const length = Number(header);
  return Number.isFinite(length) && length > maxBytes + slack;
}
