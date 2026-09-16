import type { DeadlineSpec } from "@/lib/deadlines";
import { computeDeadline } from "@/lib/deadlines";
import type { KeyDate, Obligation, Risk } from "@/lib/summary/risks";

/**
 * The five questions to bring to a lawyer.
 *
 * Derived, not generated. Every question is built from a risk or an obligation
 * the model already produced and that already passed the citation gate, so:
 *
 * - each question carries the clause IDs it came from, and those IDs are the
 *   same ones shown everywhere else on the page;
 * - there is no second model call, so no new opportunity to invent a clause and
 *   no added latency on the one action a user takes under time pressure;
 * - the wording is predictable, which matters more than it sounds: a question
 *   that reads like a generated paragraph is hard to ask out loud, and the
 *   whole point of this list is that somebody asks it.
 *
 * The templates are deliberately about *asking*, never about answering. "Is
 * this enforceable?" is a good question for a lawyer and a terrible thing for
 * this tool to assert, so the tool only ever asks it.
 */

export type QuestionSource = "risk" | "deadline" | "money" | "coverage";

export type LawyerQuestion = {
  question: string;
  /** Clause IDs this question is about -- always the ones already verified. */
  clauseIds: string[];
  source: QuestionSource;
  /** Short label for the UI/manifest, e.g. the risk it came from. */
  about: string;
};

export type QuestionInput = {
  risks: readonly Risk[];
  obligations: readonly Obligation[];
  keyDates: readonly KeyDate[];
  clauses: readonly { id: string; text: string; kind: string }[];
  anchorDate: string;
};

/** The brief asks for five; more than that stops being a brief. */
export const QUESTION_TARGET = 5;

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;

/** Money, in the forms contracts actually write it. */
const MONEY_PATTERN = /(₹|rs\.?\s?\d|\binr\b|\brupees\b|\d[\d,]*\s?(?:lakh|crore))/i;

/**
 * A short list of things most agreements of this kind settle, each with the
 * words that would indicate this document does. Used to spot gaps.
 *
 * Every pattern is a *stem* followed by `\w*`, not a whole word: the first cut
 * used `\bdispute\b` and `\brepair\b`, which match "dispute" and "repair" but
 * not the plural forms a contract actually uses -- so a document that plainly
 * covered a topic was reported as silent on it. A false "this is missing" is the
 * harmful direction of error here, so the stems are deliberately loose.
 *
 * This remains a keyword check, and the question is phrased so that stays
 * honest: it says the document does not address the topic *by name*, which is
 * exactly what was checked. Claiming "your agreement is missing a notice
 * clause" from a keyword match would be overreach.
 */
const COVERAGE_TOPICS: { topic: string; question: string; patterns: RegExp }[] = [
  {
    topic: "notice to end the agreement",
    question: "How much notice must each side give to end this agreement, and how must it be given?",
    patterns: /\bnotic\w*/i,
  },
  {
    topic: "the security deposit and its return",
    question: "When exactly must the deposit be returned, and what can be deducted from it?",
    patterns: /\b(deposit|securit)\w*/i,
  },
  {
    topic: "how disputes are resolved",
    question: "If we disagree about this agreement, how is the dispute resolved, and who decides?",
    patterns: /\b(disput|arbitrat|jurisdict|court|tribunal|mediat)\w*/i,
  },
  {
    topic: "ending the agreement early",
    question: "What happens if either side wants to end this agreement early, and what would it cost?",
    patterns: /\b(terminat|lock-?in|expir|expire|early|forfeit)\w*/i,
  },
  {
    topic: "repairs and maintenance",
    question: "Which repairs and running costs are mine, and which are the other side's?",
    patterns: /\b(repair|maintain|maintenance|upkeep|wear and tear)\w*/i,
  },
  {
    topic: "increases in rent or charges",
    question: "Can the rent or any charge be increased during the term, and by how much?",
    patterns: /\b(increas|escalat|revis|enhanc|rais)\w*/i,
  },
  {
    topic: "liability and indemnity",
    question: "What am I on the hook for if something goes wrong, and is that liability capped?",
    patterns: /\b(indemnif|liabilit|liable|insur)\w*/i,
  },
];

/**
 * How many gap questions may appear in the list.
 *
 * Without a cap, a document that simply does not use these keywords hands the
 * reader five generic questions and none drawn from its own contents -- the
 * exact opposite of a *tailored* brief. Two keeps the list mostly about this
 * document while still making room for what it leaves unsaid.
 */
const MAX_COVERAGE_QUESTIONS = 2;

function uniqueQuestions(questions: LawyerQuestion[]): LawyerQuestion[] {
  const seen = new Set<string>();
  const out: LawyerQuestion[] = [];

  for (const question of questions) {
    // Compare on the question text alone: two risks can be about the same
    // thing in different words, but an identical question twice is just noise.
    const key = question.question.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
  }

  return out;
}

/** Risks first, most serious first -- they are the reason the brief exists. */
function riskQuestions(risks: readonly Risk[]): LawyerQuestion[] {
  return [...risks]
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .map((risk) => ({
      // The risk explanation is already plain language and specific, so the
      // question can be built from it rather than restating the clause.
      question: `${risk.title} — ${lowerFirst(risk.explanation)} Is this enforceable as written, and is there room to negotiate it?`,
      clauseIds: risk.clauseIds,
      source: "risk" as const,
      about: risk.title,
    }));
}

/** One-off deadlines are the thing people actually miss, so they rank next. */
function deadlineQuestions(
  obligations: readonly Obligation[],
  keyDates: readonly KeyDate[],
  anchorDate: string,
): LawyerQuestion[] {
  const questions: LawyerQuestion[] = [];

  for (const obligation of obligations) {
    if (obligation.deadline.quotedText === "") continue;
    if (obligation.deadline.basis !== "anchor" && obligation.deadline.basis !== "recurring") continue;

    const computed = computeDeadline(anchorDate, obligation.deadline);
    const when = computed ? ` (${computed.display})` : "";

    questions.push({
      question: `${capitalise(obligation.description)} The document says “${obligation.deadline.quotedText}”${when}. What happens if that deadline slips, and is there any flexibility?`,
      clauseIds: obligation.clauseIds,
      source: "deadline",
      about: obligation.description,
    });
  }

  for (const entry of keyDates) {
    const computed = computeDeadline(anchorDate, entry.deadline);
    questions.push({
      question: `${entry.label} falls on ${computed ? computed.display : `“${entry.deadline.quotedText}”`}. What should I do before that date, and what happens if I miss it?`,
      clauseIds: entry.clauseIds,
      source: "deadline",
      about: entry.label,
    });
  }

  return questions;
}

/** Money clauses are worth a question whether or not they carry a deadline. */
function moneyQuestions(obligations: readonly Obligation[]): LawyerQuestion[] {
  return obligations
    .filter((obligation) => MONEY_PATTERN.test(obligation.description) || MONEY_PATTERN.test(obligation.deadline.quotedText))
    .map((obligation) => ({
      question: `${capitalise(obligation.description)} Is the amount and the basis for it fixed, or can it be changed or challenged?`,
      clauseIds: obligation.clauseIds,
      source: "money" as const,
      about: obligation.description,
    }));
}

/**
 * Topics the document does not mention by name, in descending order of how
 * commonly they matter. Ranked last: a question drawn from a clause the reader
 * actually has beats a question about a clause that may not be needed.
 *
 * Exported separately from the ranking so that *detection* can be tested
 * exhaustively while *selection* is capped -- the cap would otherwise hide
 * every gap below the first two from the tests as well as the reader.
 */
export function detectCoverageGaps(
  clauses: readonly { id: string; text: string; kind: string }[],
): LawyerQuestion[] {
  // The preamble is not the operative part of the document, so a word there
  // must not suppress a gap question.
  const body = clauses
    .filter((clause) => clause.kind !== "preamble")
    .map((clause) => clause.text)
    .join(" ");

  return COVERAGE_TOPICS.filter((topic) => !topic.patterns.test(body)).map((topic) => ({
    question: `${topic.question} The document does not appear to address ${topic.topic} by name.`,
    // No citation: the point of the question is that no clause covers it, and
    // inventing one to make the chip row look complete would be a lie.
    clauseIds: [],
    source: "coverage" as const,
    about: topic.topic,
  }));
}

function lowerFirst(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function capitalise(value: string): string {
  if (value.length === 0) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Rank every candidate question, best first. The order is the policy: what the
 * document does to you, then what it makes you do on a date, then what it costs
 * you, then what it leaves unsaid.
 */
function rankQuestions(input: QuestionInput): LawyerQuestion[] {
  const fromDocument = uniqueQuestions([
    ...riskQuestions(input.risks),
    ...deadlineQuestions(input.obligations, input.keyDates, input.anchorDate),
    ...moneyQuestions(input.obligations),
  ]);

  const fromGaps = uniqueQuestions(detectCoverageGaps(input.clauses)).slice(
    0,
    MAX_COVERAGE_QUESTIONS,
  );

  return uniqueQuestions([...fromDocument, ...fromGaps]);
}

export function buildLawyerQuestions(
  input: QuestionInput,
  target: number = QUESTION_TARGET,
): LawyerQuestion[] {
  return rankQuestions(input).slice(0, Math.max(1, target));
}

/** Exposed so the UI can say how many candidates it could not fit. */
export function countAvailableQuestions(input: QuestionInput): number {
  return rankQuestions(input).length;
}

export { COVERAGE_TOPICS };
export type { DeadlineSpec };
