import { computeDeadline, formatDisplayDate, isValidIsoDate } from "@/lib/deadlines";
import { parseClauseId, PREAMBLE_ID, type Clause } from "@/lib/segment";
import type { CitationReport } from "@/lib/summary/verify";
import type { AnalysisReport, KeyDate, Obligation, Risk } from "@/lib/summary/risks";
import { SEVERITY_LABEL } from "@/lib/summary/risks";
import { buildLawyerQuestions, countAvailableQuestions, type LawyerQuestion } from "@/lib/brief/questions";

/**
 * The lawyer-prep brief.
 *
 * A pure function of data the browser already has -- the summary, risks,
 * obligations and key dates from the analysis, plus the anchor date the user
 * chose. No route, no second model call, no new latency on the one action
 * somebody takes while they are in a hurry. Everything in the brief is
 * therefore something the reader can already see above it, rearranged for
 * somebody else to read.
 *
 * That is also why it is safe: there is no path from here to a claim that was
 * not already checked by the citation and quote gates.
 */

export type BriefSection = {
  heading: string;
  /** Plain paragraphs, rendered in order. */
  paragraphs: string[];
  /** Optional clause IDs for the section as a whole. */
  clauseIds?: string[];
};

export type BriefItem = {
  title: string;
  severity?: string;
  body: string;
  /** Quoted document wording, when there is any. */
  quote?: string;
  /** Computed date, when the arithmetic could place it. */
  date?: string;
  /** Why there is no date, when there is none. */
  dateNote?: string;
  clauseIds: string[];
};

export type Brief = {
  title: string;
  generatedAt: Date;
  document: {
    filename: string;
    documentType: string;
    headline: string;
    pageCount: number | null;
    clauseCount: number;
    anchorDate: string;
  };
  situation: string[];
  obligations: BriefItem[];
  risks: BriefItem[];
  keyDates: BriefItem[];
  questions: LawyerQuestion[];
  /** Candidate questions that did not fit in the five. */
  moreQuestionsAvailable: number;
  verification: {
    citationsVerified: number;
    citationsDiscarded: number;
    risksDropped: number;
    obligationsDropped: number;
    unverifiedDeadlineQuotes: number;
    model: string;
    usedFallback: boolean;
  };
};

export type BriefInput = {
  filename: string;
  pageCount: number | null;
  clauseCount: number;
  clauses: readonly Clause[];
  summary: {
    documentType: string;
    headline: string;
    sentences: { text: string; clauseIds: string[] }[];
  };
  risks: readonly Risk[];
  obligations: readonly Obligation[];
  keyDates: readonly KeyDate[];
  citations: CitationReport;
  analysis: AnalysisReport;
  generation: { model: string; usedFallback: boolean };
  anchorDate: string;
};

/**
 * "CLAUSE-02" reads as "clause 2" here, not "clause 02" -- the brief is a
 * document written for a person to read out, and the zero padding is an
 * artefact of the ID scheme, not something anybody says.
 */
function clauseLabel(clauseIds: readonly string[]): string {
  if (clauseIds.length === 0) return "no clause to point to";

  return clauseIds
    .map((id) => {
      if (id === PREAMBLE_ID) return "the preamble";
      const index = parseClauseId(id);
      return `clause ${index ?? id}`;
    })
    .join(", ");
}

/** Why a deadline has no date — the same four reasons the UI distinguishes. */
function dateNoteFor(obligation: Obligation): string | undefined {
  if (obligation.deadlineUnverified) {
    return "a deadline was reported here but could not be found in the clause, so it is not relied on";
  }
  switch (obligation.deadline.basis) {
    case "event":
      return "runs from an event that has not happened yet, so no date is calculated";
    case "recurring":
      return "repeats, so there is no single date";
    case "anchor":
      return "stated without a quantity we could turn into a date";
    default:
      return undefined;
  }
}

function obligationToItem(obligation: Obligation, anchorDate: string): BriefItem {
  const computed = computeDeadline(anchorDate, obligation.deadline);

  return {
    title: obligation.party,
    body: obligation.description,
    quote: obligation.deadline.quotedText || undefined,
    date: computed?.display,
    dateNote: computed ? undefined : dateNoteFor(obligation),
    clauseIds: obligation.clauseIds,
  };
}

function riskToItem(risk: Risk): BriefItem {
  return {
    title: risk.title,
    severity: SEVERITY_LABEL[risk.severity],
    body: risk.explanation,
    clauseIds: risk.clauseIds,
  };
}

function keyDateToItem(entry: KeyDate, anchorDate: string): BriefItem {
  const computed = computeDeadline(anchorDate, entry.deadline);
  return {
    title: entry.label,
    body: computed ? `Falls on ${computed.display}.` : "No date could be worked out from the anchor date.",
    quote: entry.deadline.quotedText,
    date: computed?.display,
    clauseIds: entry.clauseIds,
  };
}

export function buildBrief(input: BriefInput): Brief {
  const anchor = isValidIsoDate(input.anchorDate) ? input.anchorDate : "";

  const questionInput = {
    risks: input.risks,
    obligations: input.obligations,
    keyDates: input.keyDates,
    clauses: input.clauses,
    anchorDate: anchor,
  };

  const questions = buildLawyerQuestions(questionInput);
  const available = countAvailableQuestions(questionInput);

  return {
    title: `Lawyer-prep brief — ${input.summary.documentType}`,
    generatedAt: new Date(),
    document: {
      filename: input.filename,
      documentType: input.summary.documentType,
      headline: input.summary.headline,
      pageCount: input.pageCount,
      clauseCount: input.clauseCount,
      anchorDate: anchor,
    },
    situation: input.summary.sentences.map((sentence) => sentence.text),
    obligations: input.obligations.map((obligation) => obligationToItem(obligation, anchor)),
    risks: input.risks.map(riskToItem),
    keyDates: input.keyDates.map((entry) => keyDateToItem(entry, anchor)),
    questions,
    moreQuestionsAvailable: Math.max(0, available - questions.length),
    verification: {
      citationsVerified: input.citations.verifiedCount,
      citationsDiscarded: input.citations.discardedCount,
      risksDropped: input.analysis.risksDropped,
      obligationsDropped: input.analysis.obligationsDropped,
      unverifiedDeadlineQuotes: input.analysis.unverifiedDeadlineQuotes,
      model: input.generation.model,
      usedFallback: input.generation.usedFallback,
    },
  };
}

/**
 * Markdown for copying or saving. Deliberately complete: the brief is meant to
 * leave this app, so it carries the disclaimer and the method note with it
 * rather than assuming the reader has seen the page it came from.
 */
export function briefToMarkdown(brief: Brief): string {
  const lines: string[] = [];
  const generated = formatDisplayDate(
    `${brief.generatedAt.getFullYear()}-${String(brief.generatedAt.getMonth() + 1).padStart(2, "0")}-${String(
      brief.generatedAt.getDate(),
    ).padStart(2, "0")}`,
  );

  lines.push(`# ${brief.title}`, "");
  lines.push(
    `Prepared with LawSamjho on ${generated} from **${brief.document.filename}**${
      brief.document.pageCount ? ` (${brief.document.pageCount} pages)` : ""
    }, ${brief.document.clauseCount} clauses.`,
    "",
  );
  lines.push(
    "> This is a summary of a document, prepared to help a conversation with a qualified",
    "> lawyer. It is **not legal advice** and it is not a substitute for one. Every point",
    "> below is tied to the clause it came from so it can be checked.",
    "",
  );

  if (brief.document.anchorDate) {
    lines.push(
      `Deadlines below are counted from **${formatDisplayDate(brief.document.anchorDate)}**, the starting date entered. ` +
        "If the agreement starts on a different date, change it on the Obligations or Key dates panel and this brief will use it.",
      "",
    );
  }

  lines.push("## 1. Situation in short", "");
  lines.push(brief.document.headline, "");
  for (const sentence of brief.situation) lines.push(`- ${sentence}`);
  lines.push("");

  lines.push("## 2. What this document requires", "");
  if (brief.obligations.length === 0) {
    lines.push("_No obligations were identified._", "");
  }
  for (const item of brief.obligations) {
    lines.push(`- **${item.title}** — ${item.body}`);
    if (item.quote) lines.push(`  - Document says: “${item.quote}”`);
    if (item.date) lines.push(`  - Date: **${item.date}**`);
    else if (item.dateNote) lines.push(`  - No date: ${item.dateNote}`);
    lines.push(`  - Source: ${clauseLabel(item.clauseIds)}`);
  }
  lines.push("");

  lines.push("## 3. Where it works against the reader", "");
  if (brief.risks.length === 0) {
    lines.push("_No risks were identified._", "");
  }
  for (const item of brief.risks) {
    lines.push(`- **${item.severity ?? "Risk"} — ${item.title}**`);
    lines.push(`  - ${item.body}`);
    lines.push(`  - Source: ${clauseLabel(item.clauseIds)}`);
  }
  lines.push("");

  lines.push("## 4. Dates to diarise", "");
  if (brief.keyDates.length === 0) {
    lines.push("_The document does not fix any dates of its own._", "");
  }
  for (const item of brief.keyDates) {
    lines.push(`- **${item.title}** — ${item.date ?? item.body}`);
    if (item.quote) lines.push(`  - Document says: “${item.quote}”`);
    lines.push(`  - Source: ${clauseLabel(item.clauseIds)}`);
  }
  lines.push("");

  lines.push(`## 5. Questions to ask a lawyer`, "");
  brief.questions.forEach((question, index) => {
    const source = question.clauseIds.length > 0 ? ` _(${clauseLabel(question.clauseIds)})_` : "";
    lines.push(`${index + 1}. ${question.question}${source}`);
  });
  if (brief.moreQuestionsAvailable > 0) {
    lines.push("", `_${brief.moreQuestionsAvailable} further question(s) were left out to keep this list to five._`);
  }
  lines.push("");

  lines.push("---", "");
  lines.push("## How this was prepared", "");
  lines.push(
    `The document was split into ${brief.document.clauseCount} numbered clauses by a deterministic step, and every claim was checked against those clause IDs before being shown: **${brief.verification.citationsVerified}** citation(s) verified, **${brief.verification.citationsDiscarded}** discarded.`,
  );
  if (brief.verification.unverifiedDeadlineQuotes > 0) {
    lines.push(
      `${brief.verification.unverifiedDeadlineQuotes} deadline(s) were reported that could not be found in the cited clause; those are not shown and no dates were calculated from them.`,
    );
  }
  lines.push(
    "Deadlines are computed by date arithmetic in the application, not by the language model.",
    `Model: ${brief.verification.model}${brief.verification.usedFallback ? " (fallback tier)" : ""}.`,
  );

  return lines.join("\n");
}
