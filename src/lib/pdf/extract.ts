import { extractText } from "unpdf";
import { hasPdfSignature } from "@/lib/upload";

/**
 * Text extraction.
 *
 * PDF only, and only the text layer -- no OCR, no images. A scanned document
 * therefore comes back with little or no text, and the caller must say so
 * plainly rather than letting the model summarise nothing.
 */

export type ExtractedDocument = {
  text: string;
  sourceKind: "pdf" | "text";
  pageCount: number | null;
  warnings: string[];
};

/** Below this, a "text layer" is really just a header, or a scan. */
const MIN_USEFUL_TEXT = 80;

export function decodeTextBytes(bytes: Uint8Array): string {
  // Strip a UTF-8 BOM if the file has one; it otherwise shows up as a stray
  // character at the start of the first clause.
  const withoutBom =
    bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
      ? bytes.subarray(3)
      : bytes;

  return new TextDecoder("utf-8", { fatal: false }).decode(withoutBom);
}

export async function extractFromBytes(
  bytes: Uint8Array,
  kind: "pdf" | "text",
): Promise<ExtractedDocument> {
  if (kind === "text") {
    return {
      text: decodeTextBytes(bytes),
      sourceKind: "text",
      pageCount: null,
      warnings: [],
    };
  }

  if (!hasPdfSignature(bytes)) {
    return {
      text: "",
      sourceKind: "pdf",
      pageCount: null,
      warnings: ["That file is not a valid PDF."],
    };
  }

  let pageCount: number | null = null;
  let text = "";

  try {
    // `mergePages: true` is typed as returning a single string, but unpdf has
    // historically returned an array here; accept both rather than shipping a
    // crash on a minor version bump.
    const extracted = (await extractText(bytes, { mergePages: true })) as {
      totalPages: number;
      text: string | string[];
    };
    pageCount = extracted.totalPages;
    text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
  } catch {
    return {
      text: "",
      sourceKind: "pdf",
      pageCount: null,
      warnings: [
        "This PDF could not be read. If it is password-protected or corrupt, try a different copy.",
      ],
    };
  }

  const warnings: string[] = [];

  if (text.trim().length < MIN_USEFUL_TEXT) {
    warnings.push(
      "Almost no text could be read from this PDF. It is most likely a scan or a photograph of a document, and this tool cannot read those yet — there is nothing here for the summary to be based on.",
    );
  }

  return { text, sourceKind: "pdf", pageCount, warnings };
}
