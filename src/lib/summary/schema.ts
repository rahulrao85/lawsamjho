import { z } from "zod";

/**
 * Two schemas, deliberately.
 *
 * `modelAnalysisSchema` is the shape handed to the provider. It is types only --
 * no `minItems`, no `maxItems`, no string length bounds, no enums. That is not
 * laziness: Gemini's structured-output endpoint rejects a schema whose
 * constraints it cannot enumerate, and the first attempt at a strict schema
 * failed live with "The specified schema produces a constraint that has too many
 * states for serving ... schemas with long array length limits (especially when
 * nested)". Since these bounds sit on nested arrays, the state space explodes
 * and the request never even reaches the model.
 *
 * `documentAnalysisSchema` is the real contract, applied to the response the
 * moment it arrives. Nothing is rendered unless it passes *this*.
 *
 * The split keeps the promise intact -- a response that fails validation is a
 * failed generation -- while letting the provider do what it can actually
 * serve.
 *
 * Note what is deliberately *not* enforced here. Vocabulary (severity, deadline
 * unit, direction, basis) arrives as free text and is normalised per item in
 * `risks.ts`, where a bad item is dropped on its own and counted, rather than
 * failing the whole response. One malformed risk should not cost the user their
 * summary, and an enum in the provider schema would have done exactly that.
 */

/* -------------------------------------------------------------------------- */
/* Provider-facing schema: shape only                                          */
/* -------------------------------------------------------------------------- */

export const modelAnalysisSchema = z.object({
  documentType: z.string(),
  headline: z.string(),
  sentences: z.array(
    z.object({
      text: z.string(),
      clauseIds: z.array(z.string()),
    }),
  ),
  keyTerms: z.array(
    z.object({
      term: z.string(),
      plainMeaning: z.string(),
      clauseIds: z.array(z.string()),
    }),
  ),
  risks: z.array(
    z.object({
      title: z.string(),
      explanation: z.string(),
      severity: z.string(),
      clauseIds: z.array(z.string()),
    }),
  ),
  obligations: z.array(
    z.object({
      description: z.string(),
      party: z.string(),
      clauseIds: z.array(z.string()),
      // The deadline in the document's own words -- never a computed date.
      deadlineQuotedText: z.string(),
      // The offset, reported separately so plain arithmetic can compute the
      // date. Free text, because the model's vocabulary varies.
      deadlineAmount: z.string(),
      deadlineUnit: z.string(),
      deadlineDirection: z.string(),
      deadlineBasis: z.string(),
    }),
  ),
  keyDates: z.array(
    z.object({
      label: z.string(),
      clauseIds: z.array(z.string()),
      deadlineQuotedText: z.string(),
      deadlineAmount: z.string(),
      deadlineUnit: z.string(),
      deadlineDirection: z.string(),
      deadlineBasis: z.string(),
    }),
  ),
});

/* -------------------------------------------------------------------------- */
/* Application-facing schema: the contract that is actually enforced            */
/* -------------------------------------------------------------------------- */

export const documentAnalysisSchema = z.object({
  /** e.g. "Residential rent agreement". */
  documentType: z.string().min(3).max(80),
  /** A single line a reader could repeat to someone else. */
  headline: z.string().min(10).max(220),
  /**
   * A pathological-output ceiling. The real limit is relative to the number of
   * clauses and is applied in `generate.ts` (`maxExpectedSentences`), because a
   * fixed number cannot be right for both a two-page agreement and a lease.
   *
   * The lower bound is 1, not 3: a short document with a single clause has one
   * point to make, and demanding three sentences rejected perfectly good output
   * with a confusing error.
   */
  sentences: z
    .array(
      z.object({
        text: z.string().min(10).max(500),
        clauseIds: z.array(z.string().min(1).max(40)).min(1).max(8),
      }),
    )
    .min(1)
    .max(150),
  keyTerms: z
    .array(
      z.object({
        term: z.string().min(2).max(80),
        plainMeaning: z.string().min(10).max(500),
        clauseIds: z.array(z.string().min(1).max(40)).min(1).max(8),
      }),
    )
    .max(16),
  // Loosely bounded on purpose -- each item is normalised and gated
  // individually in risks.ts, which is where the real filtering happens.
  risks: z
    .array(
      z.object({
        title: z.string().max(200),
        explanation: z.string().max(1000),
        severity: z.string().max(40),
        clauseIds: z.array(z.string().max(40)).max(8),
      }),
    )
    .max(60),
  obligations: z
    .array(
      z.object({
        description: z.string().max(600),
        party: z.string().max(120),
        clauseIds: z.array(z.string().max(40)).max(8),
        deadlineQuotedText: z.string().max(600),
        deadlineAmount: z.string().max(40),
        deadlineUnit: z.string().max(40),
        deadlineDirection: z.string().max(40),
        deadlineBasis: z.string().max(60),
      }),
    )
    .max(60),
  keyDates: z
    .array(
      z.object({
        label: z.string().max(120),
        clauseIds: z.array(z.string().max(40)).max(8),
        deadlineQuotedText: z.string().max(600),
        deadlineAmount: z.string().max(40),
        deadlineUnit: z.string().max(40),
        deadlineDirection: z.string().max(40),
        deadlineBasis: z.string().max(60),
      }),
    )
    .max(30),
});

export type ModelAnalysis = z.infer<typeof documentAnalysisSchema>;
export type ModelSummarySentence = ModelAnalysis["sentences"][number];
export type ModelKeyTerm = ModelAnalysis["keyTerms"][number];

/** What the page renders, after verification. */
export type SimplifySummary = {
  documentType: string;
  headline: string;
  sentences: { text: string; clauseIds: string[] }[];
  keyTerms: { term: string; plainMeaning: string; clauseIds: string[] }[];
};
