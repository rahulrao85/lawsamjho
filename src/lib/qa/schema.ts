import { z } from "zod";
import { PREAMBLE_ID, parseClauseId, CLAUSE_ID_PREFIX } from "@/lib/segment";
import { QUESTION_LIMITS } from "@/lib/injection";
import type { AskRequest, AskSuccessResponse } from "@/lib/api-contract";

/**
 * Shapes for grounded Q&A.
 *
 * Same split as the summary: the provider gets a shape-only schema (its
 * structured-output endpoint rejects constrained schemas it cannot enumerate),
 * and the real contract is applied to the response before anything is shown.
 */

/* -------------------------------------------------------------------------- */
/* Provider-facing: shape only                                                 */
/* -------------------------------------------------------------------------- */

export const modelAnswerSchema = z.object({
  /**
   * "answered" when the clauses support an answer, "not-in-document" when they
   * do not. Kept as a free string for the provider and narrowed below.
   */
  status: z.string(),
  answer: z.string(),
  clauseIds: z.array(z.string()),
});

/* -------------------------------------------------------------------------- */
/* Application-facing: enforced                                                */
/* -------------------------------------------------------------------------- */

export const ANSWER_STATUSES = ["answered", "not-in-document"] as const;

/**
 * These are lists, not a conversation: each question is answered independently
 * from the document. History is deliberately not sent, so an answer can never
 * rest on context the citations do not support.
 */
export type AnswerStatus = (typeof ANSWER_STATUSES)[number];

const ANSWERED_WORDS = new Set([
  "answered",
  "answer",
  "yes",
  "found",
  "indocument",
  "covered",
  "cananswer",
]);

const NOT_IN_DOCUMENT_WORDS = new Set([
  "notindocument",
  "notinthedocument",
  "notcovered",
  "unanswerable",
  "unanswered",
  "notfound",
  "notanswered",
  "unknown",
  "absent",
  "silent",
  "no",
  "none",
  "insufficient",
  "cannotanswer",
  "cannotanswerfromdocument",
]);

/**
 * Normalise the status word before enforcing the enum.
 *
 * Writing an `enum` into the provider schema is not an option (its
 * structured-output endpoint rejects constrained schemas it cannot enumerate),
 * so the model is free to write "not_in_document" instead of "not-in-document".
 * Treating that as a malformed response is how a *correct* answer -- "the
 * document doesn't cover this" -- turns into a 422 for the user. The wording
 * varies; the meaning does not, so the wording is normalised here.
 */
export function normaliseAnswerStatus(value: unknown): AnswerStatus | null {
  if (typeof value !== "string") return null;
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (ANSWERED_WORDS.has(key)) return "answered";
  if (NOT_IN_DOCUMENT_WORDS.has(key)) return "not-in-document";
  return null;
}

/** Raw shape, before the status word is normalised. */
export const rawAnswerSchema = z.object({
  status: z.string().max(60),
  answer: z.string().max(2000),
  clauseIds: z.array(z.string().min(1).max(40)).max(12),
});

/**
 * The contract that is actually enforced, after normalisation. `answer` is
 * bounded but may be empty for `not-in-document`: the message shown to the user
 * in that case is composed by the server, not by the model.
 */
export const answerSchema = z.object({
  status: z.enum(ANSWER_STATUSES),
  answer: z.string().max(1200),
  clauseIds: z.array(z.string().min(1).max(40)).max(8),
});

export type ModelAnswer = z.infer<typeof answerSchema>;

/* -------------------------------------------------------------------------- */
/* Request validation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The client sends back the clauses it already has, rather than the document.
 *
 * Re-uploading would mean extracting and segmenting again for every question.
 * The trade is that the clause list is client-supplied -- which is fine, and
 * worth being explicit about: the only person who can be misled is the person
 * who sent it, and the citation gate still guarantees that every citation
 * resolves to a clause in the set the answer was actually drawn from.
 *
 * Bounds are enforced anyway, because an unbounded body is an unbounded prompt.
 */
const clauseSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(40)
    .refine(
      (value) => value.toUpperCase() === PREAMBLE_ID || parseClauseId(value) !== null,
      { message: `must be ${PREAMBLE_ID} or ${CLAUSE_ID_PREFIX}-nn` },
    ),
  index: z.number().int().min(0).max(1000),
  label: z.string().max(80),
  text: z.string().min(1).max(20_000),
  kind: z.enum(["preamble", "numbered", "paragraph", "whole"]),
});

export const askRequestSchema = z.object({
  question: z.string().min(1).max(QUESTION_LIMITS.max),
  clauses: z.array(clauseSchema).min(1).max(400),
});

/**
 * Compile-time check that the runtime schema and the shared wire type have not
 * drifted apart. If either changes shape, this stops the build.
 */
const _requestMatchesContract = (value: z.infer<typeof askRequestSchema>): AskRequest => value;
void _requestMatchesContract;

export type AskResponseBody = AskSuccessResponse;
