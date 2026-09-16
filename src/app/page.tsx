import Link from "next/link";
import { SystemStatus } from "@/components/SystemStatus";

const USE_CASES = [
  {
    phase: "Ready now",
    title: "Simplify",
    body: "Upload a document, get a plain-language summary and key terms — every sentence linked to the clause it came from.",
    href: "/simplify",
    ready: true,
  },
  {
    phase: "Ready now",
    title: "Risks & obligations",
    body: "Risk flags graded Low → Critical, and every obligation with the deadline in the document's own words. Calendar dates are worked out by arithmetic, not by the model.",
    href: "/simplify?view=risks",
    ready: true,
  },
  {
    phase: "Ready now",
    title: "Grounded Q&A",
    body: "Ask questions about your own document. Answers cite clause IDs and are checked before they are shown — and if the document doesn't cover something, it says so instead of guessing.",
    href: "/simplify?view=ask",
    ready: true,
  },
  {
    phase: "Ready now",
    title: "Lawyer-prep brief",
    body: "One click: situation summary, top risks with citations, computed deadlines and five tailored questions to bring to a lawyer. Print it, copy it, or download it as Markdown.",
    href: "/simplify?view=brief",
    ready: true,
  },
];

export default function Home() {
  return (
    <>
      <section className="hero stack">
        <span className="tag">Grounded document analysis</span>
        <h1>
          Legal documents, <span className="mark">explained</span> in the language
          you actually speak.
        </h1>
        <p className="lede">
          LawSamjho segments your document into numbered clauses first, then uses a
          language model only where language is the job. Every citation is checked
          against a real clause ID before it reaches you — anything the model invents
          is discarded silently.
        </p>
        <div className="hero-actions">
          <Link href="/simplify" className="btn btn-primary">
            Simplify a document
          </Link>
        </div>
      </section>

      <section aria-labelledby="usecases-heading" className="stack">
        <h2 id="usecases-heading">What it does</h2>
        <div className="grid">
          {USE_CASES.map((useCase) => (
            <article className="card" key={useCase.title}>
              <span className={`tag${useCase.ready ? "" : " tag-accent"}`}>
                {useCase.phase}
              </span>
              <h3>
                {useCase.href ? <Link href={useCase.href}>{useCase.title}</Link> : useCase.title}
              </h3>
              <p className="muted">{useCase.body}</p>
            </article>
          ))}
        </div>
      </section>

      <SystemStatus />
    </>
  );
}
