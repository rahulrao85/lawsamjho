import { generateText } from "ai";
import { getModelChain } from "@/lib/llm/gemini";

/**
 * Vision fallback for scanned and photographed PDFs.
 *
 * The text-layer extraction in extract.ts fails on anything that is really an
 * image -- a scan, a phone photo of a signed page. Rather than refusing those
 * outright, the raw PDF bytes are sent to Gemini's multimodal endpoint and
 * transcribed. This is transcription, not analysis: the prompt asks for the
 * words on the page, verbatim, not a summary or an opinion -- everything after
 * this point in the pipeline (segmentation, citation gates) is unchanged and
 * treats the result exactly like a normal text layer.
 *
 * This is inherently less reliable than a real text layer -- a model reading an
 * image can misread a digit or a name. The caller must label the result as
 * transcribed so the reader knows to check names, amounts and dates against the
 * original, the same discipline ClauseSaathi's README documents for the same
 * failure mode.
 */

const TRANSCRIBE_PROMPT = `This is a scanned or photographed page of a legal document. Transcribe its text exactly as written -- headings, numbered clauses, dates, amounts, names, signatures blocks. Do not summarise, explain, or add commentary. Preserve clause numbering and line breaks where they exist. If a word is genuinely illegible, write [illegible] rather than guessing or skipping it. Output plain text only, nothing else.`;

export type VisionTranscription = {
  text: string;
  model: string;
};

/**
 * Try each model in the configured chain in turn. A model that cannot read the
 * document (garbled output, an error, or a suspiciously short result for what
 * is presumably a real page) is treated as failed and the next one is tried,
 * the same retry-then-fallback discipline as every other model call in this
 * app. Returns null only once every model has failed.
 */
export async function transcribeViaVision(bytes: Uint8Array): Promise<VisionTranscription | null> {
  for (const { id, model } of getModelChain()) {
    try {
      const result = await generateText({
        model,
        temperature: 0,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: TRANSCRIBE_PROMPT },
              { type: "file", data: bytes, mediaType: "application/pdf" },
            ],
          },
        ],
      });

      const text = result.text.trim();
      if (text.length >= 40) {
        return { text, model: id };
      }
    } catch {
      // Try the next model in the chain.
    }
  }

  return null;
}
