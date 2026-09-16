/**
 * Regenerates the bundled sample document.
 *
 * `samples/rent-agreement.txt` is the single source of truth. This script
 * derives two things from it:
 *
 *   1. `samples/rent-agreement.pdf` -- what a visitor actually uploads, so the
 *      demo exercises the real PDF text-extraction path rather than a shortcut.
 *   2. `src/lib/samples/rent-agreement.ts` -- the same text embedded as a
 *      module, so the "try the sample" button needs no filesystem access at
 *      runtime. Next.js does not trace dynamically-read data files reliably,
 *      and a demo that depends on the working directory is a demo that breaks
 *      the moment it is deployed.
 *
 * A test asserts the embedded copy still matches the .txt, so the two cannot
 * drift apart unnoticed.
 *
 * Run with: npm run samples
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const root = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(root, "samples", "rent-agreement.txt");
const pdfPath = path.join(root, "samples", "rent-agreement.pdf");
const tsPath = path.join(root, "src", "lib", "samples", "rent-agreement.ts");

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const FONT_SIZE = 10.5;
const LINE_HEIGHT = 14;

async function buildPdf(text) {
  const pdf = await PDFDocument.create();
  pdf.setTitle("Rent Agreement (synthetic sample)");
  pdf.setSubject("Synthetic sample document bundled with LawSamjho for demonstration");
  pdf.setCreator("LawSamjho scripts/build-samples.mjs");

  const font = await pdf.embedFont(StandardFonts.Helvetica);

  // The source text is already wrapped at roughly 76 columns, and each line is
  // drawn as its own text line. That matters: clause markers must land at the
  // start of a line for the segmenter to find them, exactly as they would in a
  // real document.
  const sourceLines = text.replace(/\r\n?/g, "\n").trimEnd().split("\n");

  const linesPerPage = Math.floor((PAGE_HEIGHT - MARGIN * 2) / LINE_HEIGHT);
  let page = null;
  let lineInPage = 0;

  for (const line of sourceLines) {
    if (page === null || lineInPage >= linesPerPage) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      lineInPage = 0;
    }

    if (line.length > 0) {
      page.drawText(line, {
        x: MARGIN,
        // Offset within the page, not from the start of the document -- the
        // cursor has to reset on every new page or the overflow is drawn off
        // the canvas and silently lost.
        y: PAGE_HEIGHT - MARGIN - lineInPage * LINE_HEIGHT - FONT_SIZE,
        size: FONT_SIZE,
        font,
        color: rgb(0.08, 0.09, 0.11),
      });
    }

    lineInPage += 1;
  }

  const bytes = await pdf.save();
  await writeFile(pdfPath, bytes);
  return bytes.length;
}

async function buildModule(text) {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${")
    .replace(/\r\n?/g, "\n");

  const contents = `/**
 * GENERATED FILE -- do not edit by hand.
 *
 * Produced from samples/rent-agreement.txt by scripts/build-samples.mjs.
 * Run \`npm run samples\` after changing the .txt source.
 *
 * This is a synthetic document written for demonstration. It is not based on
 * any real agreement, and the parties named in it do not exist.
 */

export const RENT_AGREEMENT_FILENAME = "rent-agreement.txt";
export const RENT_AGREEMENT_LABEL = "Sample rent agreement";

export const RENT_AGREEMENT_TEXT = \`${escaped}\`;
`;

  await mkdir(path.dirname(tsPath), { recursive: true });
  await writeFile(tsPath, contents, "utf8");
}

const text = await readFile(sourcePath, "utf8");

if (text.trim().length === 0) {
  throw new Error(`${sourcePath} is empty; refusing to generate a blank sample.`);
}

const pdfBytes = await buildPdf(text);
await buildModule(text);

console.log(`samples/rent-agreement.txt   ${text.length} chars`);
console.log(`samples/rent-agreement.pdf   ${pdfBytes} bytes`);
console.log(`src/lib/samples/rent-agreement.ts  regenerated`);
