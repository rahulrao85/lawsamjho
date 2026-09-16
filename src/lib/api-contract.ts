import type { Clause, SegmentationStrategy } from "@/lib/segment";
import type { AnalysisReport, KeyDate, Obligation, Risk } from "@/lib/summary/risks";
import type { CitationReport } from "@/lib/summary/verify";
import type { SimplifySummary } from "@/lib/summary/schema";

/** The wire shape of POST /api/simplify. Shared by the route and the client. */
export type SimplifySuccessResponse = {
  document: {
    filename: string;
    sourceKind: "pdf" | "text";
    pageCount: number | null;
    charCount: number;
    clauseCount: number;
  };
  segmentation: {
    strategy: SegmentationStrategy;
    warnings: string[];
  };
  extractionWarnings: string[];
  clauses: Clause[];
  summary: SimplifySummary;
  /**
   * Obligations arrive as a stated offset, never as a date. The date is computed
   * in the browser from the anchor date the user picks, using the same pure
   * functions the tests cover -- so changing the anchor date is instant and
   * needs no round trip.
   */
  risks: Risk[];
  obligations: Obligation[];
  keyDates: KeyDate[];
  citations: CitationReport;
  analysis: AnalysisReport;
  generation: {
    model: string;
    usedFallback: boolean;
    truncated: boolean;
    latencyMs: number;
  };
};

export type SimplifyErrorResponse = {
  error: { code: string; message: string; detail?: string };
};

/* ------------------------------- Grounded Q&A ----------------------------- */

export type AskRequest = {
  question: string;
  /** The clauses the answer must be grounded in -- the client already has them. */
  clauses: Clause[];
};

export type AskSuccessResponse = {
  status: "answered" | "not-in-document";
  /**
   * For `answered`, the model's answer. For `not-in-document`, a sentence the
   * server composes itself -- the model is never asked to write the "I could not
   * find this" message, so there is no unverifiable prose to show.
   */
  answer: string;
  /** Always empty when `status` is `not-in-document`. */
  clauseIds: string[];
  /** How many citations were checked, and how many had to be discarded. */
  citations: { verifiedCount: number; discardedCount: number };
  generation: {
    model: string;
    usedFallback: boolean;
    /** Generations rejected by the gates before one was accepted. */
    rejectedAttempts: number;
    latencyMs: number;
  };
};

export type AskErrorResponse = {
  error: { code: string; message: string; detail?: string };
};
