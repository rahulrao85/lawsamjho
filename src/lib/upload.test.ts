import { describe, expect, it } from "vitest";
import {
  classifyUpload,
  fileExtension,
  hasPdfSignature,
  validateUpload,
  type UploadInput,
} from "@/lib/upload";

const MAX = 2_000_000;

function pdfBytes(): Uint8Array {
  return new TextEncoder().encode("%PDF-1.7\n1 0 obj\n");
}

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
}

function input(overrides: Partial<UploadInput> = {}): UploadInput {
  return {
    filename: "agreement.pdf",
    mimeType: "application/pdf",
    bytes: pdfBytes(),
    size: 18,
    ...overrides,
  };
}

describe("fileExtension", () => {
  it("lowercases the extension", () => {
    expect(fileExtension("Rent.PDF")).toBe("pdf");
    expect(fileExtension("notes.TxT")).toBe("txt");
  });

  it("returns empty when there is no extension", () => {
    expect(fileExtension("contract")).toBe("");
    expect(fileExtension("")).toBe("");
  });

  it("uses the last dot in a dotted name", () => {
    expect(fileExtension("rent.agreement.final.pdf")).toBe("pdf");
  });
});

describe("hasPdfSignature", () => {
  it("accepts a normal PDF header", () => {
    expect(hasPdfSignature(pdfBytes())).toBe(true);
  });

  it("accepts a header preceded by junk, within the spec's allowance", () => {
    const bytes = new Uint8Array([0x00, 0x01, 0x02, ...pdfBytes()]);
    expect(hasPdfSignature(bytes)).toBe(true);
  });

  it("rejects anything that is not a PDF", () => {
    expect(hasPdfSignature(pngBytes())).toBe(false);
    expect(hasPdfSignature(new TextEncoder().encode("just text"))).toBe(false);
  });

  it("does not read past the end of a short buffer", () => {
    expect(hasPdfSignature(new Uint8Array([]))).toBe(false);
    expect(hasPdfSignature(new Uint8Array([0x25, 0x50]))).toBe(false);
    expect(hasPdfSignature(new TextEncoder().encode("%PDF"))).toBe(false);
  });
});

describe("classifyUpload", () => {
  it("classifies PDFs and text documents", () => {
    expect(classifyUpload("a.pdf", "application/pdf")).toBe("pdf");
    expect(classifyUpload("a.txt", "text/plain")).toBe("text");
    expect(classifyUpload("a.md", "text/markdown")).toBe("text");
  });

  it("tolerates a browser that sends no type, or a generic one", () => {
    expect(classifyUpload("a.pdf", "")).toBe("pdf");
    expect(classifyUpload("a.pdf", "application/octet-stream")).toBe("pdf");
    expect(classifyUpload("a.txt", "")).toBe("text");
  });

  it("falls back to an unambiguous MIME type when the name has no extension", () => {
    expect(classifyUpload("document", "application/pdf")).toBe("pdf");
    expect(classifyUpload("document", "text/plain")).toBe("text");
  });

  it("refuses images, which are explicitly out of scope until OCR exists", () => {
    expect(classifyUpload("scan.png", "image/png")).toBeNull();
    expect(classifyUpload("photo.jpg", "image/jpeg")).toBeNull();
    // A phone photo of a contract is the case a user will actually try.
    expect(classifyUpload("IMG_2026.jpeg", "image/jpeg")).toBeNull();
  });

  it("refuses Word documents and anything else unknown", () => {
    expect(
      classifyUpload("agreement.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBeNull();
    expect(classifyUpload("a.exe", "application/x-msdownload")).toBeNull();
    expect(classifyUpload("", "")).toBeNull();
  });
});

describe("validateUpload", () => {
  it("accepts a normal PDF", () => {
    expect(validateUpload(input(), MAX)).toEqual({ ok: true, kind: "pdf" });
  });

  it("accepts a normal text file", () => {
    const bytes = new TextEncoder().encode("1. A clause.");
    expect(
      validateUpload(
        { filename: "notes.txt", mimeType: "text/plain", bytes, size: bytes.length },
        MAX,
      ),
    ).toEqual({ ok: true, kind: "text" });
  });

  it("rejects an empty file", () => {
    const result = validateUpload(input({ size: 0 }), MAX);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a file over the limit as 413, without inspecting its contents", () => {
    const result = validateUpload(input({ size: MAX + 1 }), MAX);
    expect(result).toMatchObject({ ok: false, status: 413 });
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateUpload(input({ size: MAX }), MAX)).toEqual({ ok: true, kind: "pdf" });
  });

  it("rejects an unsupported type as 415", () => {
    const result = validateUpload(
      { filename: "scan.png", mimeType: "image/png", bytes: pngBytes(), size: 9 },
      MAX,
    );
    expect(result).toMatchObject({ ok: false, status: 415 });
  });

  it("rejects a .pdf name whose contents are not a PDF", () => {
    // The attack this defends against is trivial: rename anything to .pdf.
    const result = validateUpload(input({ bytes: pngBytes() }), MAX);
    expect(result).toMatchObject({ ok: false, status: 415 });
    if (!result.ok) expect(result.message).toMatch(/not a PDF/i);
  });

  it("trusts the contents over a misleading extension when a PDF is named .txt", () => {
    const bytes = pdfBytes();
    expect(
      validateUpload(
        { filename: "notes.txt", mimeType: "text/plain", bytes, size: bytes.length },
        MAX,
      ),
    ).toEqual({ ok: true, kind: "pdf" });
  });

  it("does not treat an oversized PDF as valid just because the header is right", () => {
    expect(validateUpload(input({ size: MAX + 1 }), MAX)).toMatchObject({
      ok: false,
      status: 413,
    });
  });
});
