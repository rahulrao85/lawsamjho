/**
 * Prompt-injection screen for the question field.
 *
 * Two layers, deliberately unequal:
 *
 * 1. **This screen.** A pattern match over a normalised question, catching the
 *    explicit "ignore your instructions and ..." family. It is cheap, it is
 *    auditable, and it is honest about its limits: it catches clumsy attempts,
 *    not clever ones.
 * 2. **The structure of the prompt itself**, which is the real defence. The
 *    clauses and the question are each passed inside an explicit delimited
 *    block and the system prompt says that everything inside those blocks is
 *    data to be interpreted, never an instruction to follow. A pattern match
 *    that never fires still leaves the model with no path from "the document
 *    says X" to "do X".
 *
 * The screen does not try to detect *topics*. Asking about arbitration is a
 * normal question; asking the model to abandon its instructions is not, and
 * conflating the two would refuse good questions to stop bad ones.
 *
 * Normalisation happens before matching because the usual evasions are
 * typographic rather than clever: zero-width characters inside a keyword,
 * full-width or homoglyph letters, and newlines that break a phrase in two.
 */

const MAX_QUESTION_CHARS = 1000;
const MIN_QUESTION_CHARS = 2;

export type InjectionScreen = {
  /** True when the question looks like an instruction aimed at the model. */
  blocked: boolean;
  /** Which rule fired, for the message shown to the user. */
  reason: string | null;
  /** Cleaned question -- this is what goes into the prompt. */
  normalised: string;
  /** True when the input was altered by normalisation. */
  altered: boolean;
};

type Rule = { id: string; label: string; pattern: RegExp };

/**
 * Each rule targets an *instruction directed at the model*, not a word that
 * happens to appear in legal questions. "What happens if I ignore the notice
 * clause?" must not fire, which is why every override rule requires an object
 * like "instructions" rather than just the verb.
 */
const RULES: Rule[] = [
  {
    id: "override-instructions",
    label: "it asks the assistant to ignore its instructions",
    pattern:
      /\b(ignore|disregard|forget|discard|bypass|overlook)\b[^.]{0,40}?\b(previous|prior|above|earlier|preceding|foregoing|all|any|your|the)\b[^.]{0,20}?\b(instruction|instructions|prompt|prompts|rule|rules|direction|directions|guideline|guidelines|message|messages)\b/,
  },
  {
    id: "override-rules-direct",
    label: "it asks the assistant to override its rules",
    pattern:
      /\b(override|replace|change|rewrite|update)\b[^.]{0,30}?\b(your|the|these|its)\b[^.]{0,20}?\b(instruction|instructions|rule|rules|settings|configuration|prompt|prompts|behaviour|behavior)\b/,
  },
  {
    id: "forget-everything",
    label: "it asks the assistant to forget its context",
    pattern: /\bforget\b[^.]{0,30}?\b(everything|all|everything above|the above|your context|prior context)\b/,
  },
  {
    id: "role-reassignment",
    label: "it tries to give the assistant a new role",
    pattern:
      /\b(you\s*(?:'re|are)\s+now|from\s+now\s+on\s+you|you\s+must\s+now\s+(?:act|behave|respond)|pretend\s+(?:that\s+)?you\s+are|roleplay\s+as|simulate\s+being)\b/,
  },
  {
    id: "new-instructions",
    label: "it introduces a new set of instructions",
    pattern: /\b(new|updated|revised|additional|real|actual)\b[^.]{0,20}?\b(instruction|instructions|rules|prompt|prompts|persona|system\s*message)\b/,
  },
  {
    id: "prompt-exfiltration",
    label: "it asks the assistant to reveal its instructions",
    pattern:
      /\b(reveal|show|print|repeat|display|output|tell\s+me|what\s+(?:are|were))\b[^.]{0,30}?\b(your|the|its)\b[^.]{0,20}?\b(system\s+)?(prompt|prompts|instruction|instructions|rules|guidelines|configuration)\b/,
  },
  {
    id: "jailbreak",
    label: "it is a known jailbreak pattern",
    pattern: /\b(jailbreak|dan\s+mode|developer\s+mode|god\s*mode|do\s+anything\s+now)\b/,
  },
  {
    id: "role-marker",
    label: "it contains a chat role marker",
    pattern: /^\s*(system|assistant|developer|tool)\s*:/,
  },
  {
    id: "prompt-format-token",
    label: "it contains prompt-format control tokens",
    pattern: /(\[\/?inst\]|<\|[^|]{0,24}\|>|<\/?system>|<\/?assistant>|###\s*(instruction|system|prompt))/i,
  },
  {
    id: "disobey",
    label: "it tells the assistant not to follow its instructions",
    pattern:
      /\b(do\s+not|don't|dont|never)\b[^.]{0,20}?\b(follow|obey|comply\s+with|adhere\s+to|listen\s+to)\b[^.]{0,20}?\b(the|your|these|any|its)\b[^.]{0,20}?\b(instruction|instructions|rule|rules|guideline|guidelines)\b/,
  },
  {
    id: "answer-outside-document",
    label: "it asks the assistant to answer from outside the document",
    pattern:
      /\b(as\s+an?\s+ai|as\s+a\s+language\s+model|ignore\s+the\s+document|not\s+bound\s+by\s+the\s+document|without\s+using\s+the\s+document)\b/,
  },
];

/**
 * Strip the tricks that break a pattern match without changing what a reader
 * sees: zero-width and bidi characters, other control characters, and the
 * non-breaking/unicode spaces that make a phrase look joined but compare
 * differently.
 */
export function normaliseQuestion(raw: string): { text: string; altered: boolean } {
  const collapsed = raw
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, "")
    .replace(/[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g, " ")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return { text: collapsed, altered: collapsed !== raw.trim() };
}

export function screenQuestion(raw: string): InjectionScreen {
  const { text, altered } = normaliseQuestion(raw);

  if (text.length < MIN_QUESTION_CHARS) {
    return { blocked: true, reason: "it is empty or too short to be a question", normalised: text, altered };
  }

  // Match against a lowercased copy so patterns stay readable, but keep the
  // original casing for the prompt.
  const haystack = text.toLowerCase();

  for (const rule of RULES) {
    if (rule.pattern.test(haystack)) {
      return { blocked: true, reason: rule.label, normalised: text, altered };
    }
  }

  return { blocked: false, reason: null, normalised: text, altered };
}

export const QUESTION_LIMITS = {
  max: MAX_QUESTION_CHARS,
  min: MIN_QUESTION_CHARS,
};
