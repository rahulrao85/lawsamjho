import type { Metadata } from "next";
import { SimplifyWorkbench } from "@/components/simplify/SimplifyWorkbench";
import { normalisePanel } from "@/components/simplify/panels";

export const metadata: Metadata = {
  title: "Simplify a document — LawSamjho",
  description:
    "Upload a rent agreement or contract and get a plain-language summary, its risks and its obligations — every claim linked to the clause it came from.",
};

export default async function SimplifyPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  // Lets the nav link straight to a section ("Risks & obligations") without
  // client-side search-param plumbing. Reading it makes this route dynamic,
  // which is fine -- it is an upload screen, not a cached document.
  const { view } = await searchParams;

  return (
    <div className="stack-lg">
      <section className="hero stack no-print">
        <span className="tag">Step 1 — Simplify</span>
        <h1>
          Understand what you are <span className="mark">signing</span>.
        </h1>
        <p className="lede">
          The document is split into numbered clauses before anything is generated. The
          summary, the risks and the obligations are then each checked back against those
          clause IDs — so you can read every claim next to the clause it came from.
        </p>
      </section>

      <SimplifyWorkbench initialPanel={normalisePanel(view)} />
    </div>
  );
}
