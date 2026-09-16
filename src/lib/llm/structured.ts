import { generateObject } from "ai";
import { getModelChain } from "@/lib/llm/gemini";

/**
 * The one place a structured model call is made.
 *
 * Phase 1 built this for the summary; Phase 3 needs the same behaviour for Q&A,
 * so it lives here rather than being copied. That matters more than tidiness:
 * the retry-then-fall-back policy and the "never render unvalidated output"
 * rule are the parts most likely to drift apart if there were two copies.
 *
 * The important idea is `accept`. A response is not accepted merely because it
 * is well-formed -- the caller decides what else has to be true (budget, at
 * least one surviving citation, and so on). Anything the caller rejects counts
 * as a failed attempt, so the model gets the retry and the fallback tier rather
 * than a hard failure on the first bad generation.
 */

/** One retry per model, then move to the fallback tier. */
export const ATTEMPTS_PER_MODEL = 2;

export type AcceptResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

export type StructuredCallResult<T> = {
  value: T;
  model: string;
  usedFallback: boolean;
  latencyMs: number;
  /** How many generations were rejected before one was accepted. */
  rejectedAttempts: number;
  /** Why they were rejected, in order. Empty when the first attempt passed. */
  rejectionReasons: string[];
};

export class ModelCallError extends Error {
  readonly detail: string;

  constructor(message: string, detail = "") {
    super(message);
    this.name = "ModelCallError";
    this.detail = detail;
  }
}

/**
 * A narrow view of `generateObject`.
 *
 * The real signature is a thicket of conditional types keyed off the schema, and
 * passing a caller-supplied schema through a generic erases the literal type it
 * discriminates on. Everything crossing this boundary is `unknown` anyway --
 * `accept` is what narrows it -- so the narrowing is written once, here, instead
 * of being fought at every call site.
 */
export type StructuredGenerator = (options: {
  model: unknown;
  schema: unknown;
  system: string;
  prompt: string;
  temperature: number;
}) => Promise<{ object: unknown }>;

const defaultGenerator = generateObject as unknown as StructuredGenerator;

export type GenerateStructuredArgs<T, S> = {
  /** Shape-only schema handed to the provider. */
  schema: S;
  system: string;
  prompt: string;
  /**
   * Everything the response must satisfy beyond being well-formed. Runs after
   * the schema parse.
   */
  accept: (object: unknown) => AcceptResult<T>;
  /** Injectable for tests. */
  generate?: StructuredGenerator;
  /** Named in the error message, e.g. "summary". */
  operation: string;
};

export async function generateStructured<T, S>({
  schema,
  system,
  prompt,
  accept,
  generate = defaultGenerator,
  operation,
}: GenerateStructuredArgs<T, S>): Promise<StructuredCallResult<T>> {
  const chain = getModelChain();
  const failures: string[] = [];
  const rejectionReasons: string[] = [];
  const startedAt = Date.now();

  let accepted: T | null = null;
  let answeringModel = "";
  let usedFallback = false;

  outer: for (const [chainIndex, { id, model }] of chain.entries()) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt += 1) {
      try {
        const result = await generate({
          model,
          // Shape only -- the provider cannot serve the constrained schema.
          // The real contract is enforced on the way out, by `accept`.
          schema,
          system,
          prompt,
          temperature: 0,
        });

        const outcome = accept(result.object);
        if (outcome.ok) {
          accepted = outcome.value;
          answeringModel = id;
          usedFallback = chainIndex > 0;
          break outer;
        }

        rejectionReasons.push(`${id} attempt ${attempt}: ${outcome.reason}`);
        failures.push(`${id} attempt ${attempt}: rejected -- ${outcome.reason}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${id} attempt ${attempt}: ${message}`);
      }
    }
  }

  if (accepted === null) {
    throw new ModelCallError(
      `The model could not produce a usable ${operation}.`,
      failures.join(" | "),
    );
  }

  return {
    value: accepted,
    model: answeringModel,
    usedFallback,
    latencyMs: Date.now() - startedAt,
    rejectedAttempts: rejectionReasons.length,
    rejectionReasons,
  };
}
