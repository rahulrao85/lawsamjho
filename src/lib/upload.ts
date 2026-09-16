/**
 * Upload validation.
 *
 * Pure and synchronous wherever possible so the rules can be tested without a
 * network or a filesystem. The important one is the PDF signature check: a
 * filename extension and a browser-supplied MIME type are both attacker
 * controlled, so neither is trusted on its own.
 */

export type UploadKind = "pdf" | "text";

export const MAX_UPLOAD_LABEL = "2 MB";

const TEXT_EXTENSIONS = new Set(["txt", "text", "md", "markdown"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

const TEXT_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/octet-stream",
]);

export function fileExtension(filename: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename.trim());
  return match ? match[1].toLowerCase() : "";
}

/**
 * Decide what we are willing to try to parse, using the extension and the
 * declared MIME type. Returns null for anything else -- including images, which
 * are explicitly out of scope until OCR exists.
 */
export function classifyUpload(filename: string, mimeType: string): UploadKind | null {
  const extension = fileExtension(filename);
  const mime = mimeType.toLowerCase().split(";")[0].trim();

  if (PDF_EXTENSIONS.has(extension) && (mime === "application/pdf" || mime === "" || mime === "application/octet-stream")) {
    return "pdf";
  }
  if (TEXT_EXTENSIONS.has(extension) && (TEXT_MIME_TYPES.has(mime) || mime === "")) {
    return "text";
  }
  // No usable extension, but an unambiguous MIME type.
  if (mime === "application/pdf") return "pdf";
  if (mime === "text/plain" || mime === "text/markdown") return "text";

  return null;
}

/** A PDF starts with "%PDF-" (possibly after junk, per the spec's 1024-byte allowance). */
export function hasPdfSignature(bytes: Uint8Array): boolean {
  const window = bytes.subarray(0, Math.min(bytes.length, 1024));
  for (let offset = 0; offset + 5 <= window.length; offset += 1) {
    if (
      window[offset] === 0x25 &&
      window[offset + 1] === 0x50 &&
      window[offset + 2] === 0x44 &&
      window[offset + 3] === 0x46 &&
      window[offset + 4] === 0x2d
    ) {
      return true;
    }
  }
  return false;
}

export type UploadInput = {
  filename: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
};

export type UploadValidation =
  | { ok: true; kind: UploadKind }
  | { ok: false; status: 400 | 413 | 415; message: string };

export function validateUpload(input: UploadInput, maxBytes: number): UploadValidation {
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, status: 400, message: "The file is empty." };
  }

  if (input.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      message: `That file is larger than the ${MAX_UPLOAD_LABEL} limit.`,
    };
  }

  const kind = classifyUpload(input.filename, input.mimeType);
  if (kind === null) {
    return {
      ok: false,
      status: 415,
      message:
        "Only PDF and plain-text documents are supported. Scanned images and Word files are not supported yet.",
    };
  }

  // A .pdf that does not actually start with %PDF- is not a PDF, whatever the
  // browser claimed. Let the extension-based kind stand, but refuse to parse.
  if (kind === "pdf" && !hasPdfSignature(input.bytes)) {
    return {
      ok: false,
      status: 415,
      message:
        "That file has a .pdf name but is not a PDF. If it is a scan or a photo of a document, it is not supported yet.",
    };
  }

  if (kind === "text" && hasPdfSignature(input.bytes)) {
    return { ok: true, kind: "pdf" };
  }

  return { ok: true, kind };
}
