import { getServerEnv, type ServerEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/api-guard";
import { contentLengthExceeded, jsonError } from "@/lib/http";
import { screenQuestion, QUESTION_LIMITS } from "@/lib/injection";
import { ModelCallError } from "@/lib/llm/structured";
import { answerQuestion } from "@/lib/qa/answer";
import { askRequestSchema } from "@/lib/qa/schema";
import type { Clause } from "@/lib/segment";

/**
 * Grounded Q&A.
 *
 * The client sends the clauses it already has plus a question, so asking does
 * not mean re-uploading or re-segmenting. The question is screened before any
 * model call -- a blocked question costs nothing and gets a clear explanation
 * rather than a vague failure.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let env: ServerEnv;
  try {
    env = getServerEnv();
  } catch (error) {
    return jsonError(
      503,
      "misconfigured",
      "The server is not configured with a model API key, so questions cannot be answered.",
      error instanceof Error ? error.message : undefined,
    );
  }

  // Before the body is read: a throttled question should cost nothing at all.
  const limited = enforceRateLimit(request, env);
  if (limited) return limited;

  // A question plus its clauses: the clause list dominates the payload, and it
  // is bounded by the request schema, but reject an absurd body before reading it.
  if (contentLengthExceeded(request, 2_000_000)) {
    return jsonError(413, "too_large", "That request was too large to process.");
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return jsonError(400, "invalid_body", "The request body was not valid JSON.");
  }

  const parsed = askRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return jsonError(
      400,
      "invalid_request",
      "The question could not be processed because the request was not in the expected shape.",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; "),
    );
  }

  const screen = screenQuestion(parsed.data.question);

  if (screen.blocked) {
    const tooShort = screen.normalised.length < QUESTION_LIMITS.min;
    return jsonError(
      422,
      tooShort ? "empty_question" : "question_blocked",
      tooShort
        ? "Ask a question about the document."
        : "That reads as an instruction to the assistant rather than a question about your document, so it was not sent. Ask about something the document covers and it will be answered from the clauses.",
      screen.reason ?? undefined,
    );
  }

  try {
    const result = await answerQuestion({
      clauses: parsed.data.clauses as Clause[],
      question: screen.normalised,
    });

    return Response.json({
      status: result.status,
      answer: result.answer,
      clauseIds: result.clauseIds,
      citations: result.citations,
      generation: {
        model: result.model,
        usedFallback: result.usedFallback,
        rejectedAttempts: result.rejectedAttempts,
        latencyMs: result.latencyMs,
      },
    });
  } catch (error) {
    if (error instanceof ModelCallError) {
      return jsonError(
        422,
        "answer_ungrounded",
        "The assistant could not produce an answer whose citations checked out, so none is shown rather than an unsupported one.",
        error.detail,
      );
    }
    return jsonError(
      500,
      "unexpected",
      "Something went wrong while answering the question.",
      error instanceof Error ? error.message : undefined,
    );
  }
}
