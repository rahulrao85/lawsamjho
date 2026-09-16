import { getServerEnv } from "@/lib/env";
import { enforceRateLimit } from "@/lib/api-guard";
import { contentLengthExceeded, jsonError } from "@/lib/http";
import { extractFromBytes } from "@/lib/pdf/extract";
import { segmentClauses } from "@/lib/segment";
import { generateSummary, SummaryGenerationError } from "@/lib/summary/generate";
import { validateUpload, MAX_UPLOAD_LABEL } from "@/lib/upload";

/**
 * Upload -> extract -> segment -> summarise -> verify.
 *
 * The whole Phase 1 pipeline in one route. Everything after extraction is
 * deterministic except the single structured model call, and the response
 * carries the citation report so the client can show what the gate threw away.
 */

// unpdf is a Node library; this route must not be bundled for the edge.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Hard ceiling on pasted text, independent of the byte limit. */
const MAX_TEXT_CHARS = 400_000;

type Collected = {
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
};

async function collectUpload(request: Request): Promise<Collected | Response> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonError(400, "invalid_body", "The request body was not valid JSON.");
    }

    const body = payload as { text?: unknown; filename?: unknown } | null;
    const text = typeof body?.text === "string" ? body.text : null;

    if (text === null) {
      return jsonError(400, "missing_text", "No document text was provided.");
    }
    if (text.trim().length === 0) {
      return jsonError(400, "empty_text", "The document text was empty.");
    }
    if (text.length > MAX_TEXT_CHARS) {
      return jsonError(
        413,
        "text_too_long",
        `That document is longer than the ${Math.round(MAX_TEXT_CHARS / 1000)}k character limit for pasted text.`,
      );
    }

    return {
      filename: typeof body?.filename === "string" ? body.filename : "pasted-text.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode(text),
    };
  }

  if (!contentType.includes("multipart/form-data")) {
    return jsonError(
      415,
      "unsupported_content_type",
      "Send the document as multipart/form-data, or as JSON with a text field.",
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "invalid_form", "The upload could not be read.");
  }

  const file = form.get("document");
  if (!(file instanceof File)) {
    return jsonError(400, "missing_file", "No file was attached to the upload.");
  }

  return {
    filename: file.name || "document",
    mimeType: file.type ?? "",
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}

export async function POST(request: Request) {
  let env;
  try {
    env = getServerEnv();
  } catch (error) {
    return jsonError(
      503,
      "misconfigured",
      "The server is not configured with a model API key, so documents cannot be analysed.",
      error instanceof Error ? error.message : undefined,
    );
  }

  // Before the body is read: a throttled upload should cost nothing at all.
  const limited = enforceRateLimit(request, env);
  if (limited) return limited;

  const maxBytes = env.MAX_UPLOAD_BYTES;

  if (contentLengthExceeded(request, maxBytes)) {
    return jsonError(
      413,
      "file_too_large",
      `That file is larger than the ${MAX_UPLOAD_LABEL} limit.`,
    );
  }

  const collected = await collectUpload(request);
  if (collected instanceof Response) return collected;

  const validation = validateUpload(
    {
      filename: collected.filename,
      mimeType: collected.mimeType,
      size: collected.bytes.byteLength,
      bytes: collected.bytes,
    },
    maxBytes,
  );

  if (!validation.ok) {
    return jsonError(validation.status, "invalid_upload", validation.message);
  }

  const extracted = await extractFromBytes(collected.bytes, validation.kind);

  if (extracted.text.trim().length === 0) {
    return jsonError(
      422,
      "no_text",
      "No text could be read from this document.",
      extracted.warnings.join(" "),
    );
  }

  const segmentation = segmentClauses(extracted.text);

  if (segmentation.clauses.length === 0) {
    return jsonError(
      422,
      "no_clauses",
      "This document could not be broken into clauses, so there is nothing to summarise.",
      segmentation.warnings.join(" "),
    );
  }

  try {
    const result = await generateSummary({ clauses: segmentation.clauses });

    return Response.json({
      document: {
        filename: collected.filename,
        sourceKind: extracted.sourceKind,
        pageCount: extracted.pageCount,
        charCount: extracted.text.length,
        clauseCount: segmentation.clauses.length,
      },
      segmentation: {
        strategy: segmentation.strategy,
        warnings: segmentation.warnings,
      },
      extractionWarnings: extracted.warnings,
      clauses: segmentation.clauses,
      summary: result.summary,
      risks: result.risks,
      obligations: result.obligations,
      keyDates: result.keyDates,
      citations: result.citations,
      analysis: result.analysis,
      generation: {
        model: result.model,
        usedFallback: result.usedFallback,
        truncated: result.truncated,
        latencyMs: result.latencyMs,
      },
    });
  } catch (error) {
    if (error instanceof SummaryGenerationError) {
      return jsonError(422, "generation_failed", error.message, error.detail);
    }
    return jsonError(
      500,
      "unexpected",
      "Something went wrong while summarising the document.",
      error instanceof Error ? error.message : undefined,
    );
  }
}
