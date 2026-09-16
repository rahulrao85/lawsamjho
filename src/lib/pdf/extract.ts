import { extractText } from "unpdf";
import { hasPdfSignature } from "@/lib/upload";
import { transcribeViaVision } from "@/lib/pdf/vision";

/**
 * Text extraction.
 *
 * The text layer is tried first -- it is exact, free, and instant. When a PDF
 * has little or no text layer (a scan, a phone photo of a signed page), the
 * raw bytes go to Gemini's vision endpoint for transcription instead of
 * refusing outright. The two paths are labelled differently in `sourceKind` so
 * the UI can tell the reader which one produced the text it is looking at.
 */

export type ExtractedDocument = {
  text: string;
  sourceKind: "pdf" | "pdf-vision" | "text";
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
  // unpdf itself refusing to parse the file is a *reason* to try vision, not a
  // reason to give up -- a pdf.js structural error and "this is actually a
  // scanned image, not a text PDF" often look identical from the outside, and
  // some scanners/phone "print to PDF" flows produce files pdf.js rejects
  // outright even though the page image inside is perfectly readable.
  let unreadableTextLayer = false;

  try {
    // A copy, not `bytes` itself: unpdf's extractText (pdf.js underneath)
    // detaches the buffer it is given. `bytes` is needed again below for the
    // vision fallback, so unpdf gets its own copy to detach instead of the
    // original -- the same bug and the same fix as the upload-retention save
    // in the simplify route.
    //
    // `mergePages: true` is typed as returning a single string, but unpdf has
    // historically returned an array here; accept both rather than shipping a
    // crash on a minor version bump.
    const extracted = (await extractText(bytes.slice(), { mergePages: true })) as {
      totalPages: number;
      text: string | string[];
    };
    pageCount = extracted.totalPages;
    text = Array.isArray(extracted.text) ? extracted.text.join("\n") : extracted.text;
  } catch {
    unreadableTextLayer = true;
  }

  if (!unreadableTextLayer && text.trim().length >= MIN_USEFUL_TEXT) {
    return { text, sourceKind: "pdf", pageCount, warnings: [] };
  }

  // No usable text layer, one way or another -- most likely a scan or a photo,
  // possibly an encrypted or malformed file. Try vision before refusing.
  const transcription = await transcribeViaVision(bytes);

  if (transcription) {
    return {
      text: transcription.text,
      sourceKind: "pdf-vision",
      pageCount,
      warnings: [
        `This looked like a scan or a photograph, so its text was read by ${transcription.model}'s vision rather than a text layer. Check names, amounts and dates against the original document before relying on them.`,
      ],
    };
  }

  return {
    text: "",
    sourceKind: "pdf",
    pageCount,
    warnings: [
      unreadableTextLayer
        ? "This PDF could not be read, and it could not be transcribed either. If it is password-protected, remove the password and try again."
        : "Almost no text could be read from this PDF, and it could not be transcribed either. It is most likely a scan or a photograph of a document that is too unclear to read, or the model was unavailable.",
    ],
  };
}
