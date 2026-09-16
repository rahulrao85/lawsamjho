# Build Brief — AI for Legal Assistance & Access (Working title: LawSamjho)

**Deadline:** 17-Sep-2026 (hard, ~24h from brief creation on 16-Sep-2026)
**Role split:** OpenCode builds; Claude Code coordinates/reviews from `F:\AGENTIC WORLD`. Report progress into `STATUS.md` in this same folder (format at the bottom) so the coordinator can pick it up without re-explaining context.

## Why this scope

Competitive research (`../../LEGAL_AI_HACKATHON_RESEARCH.md`) found one verified top-scoring public repo, `Bisman-Singh/clausesaathi` (rank 3, 98.50/100, verified live at `clausesaathi.bisman.org`). Its own README documents a "Judging criteria" section with six categories — **Code Quality, Security, Efficiency, Testing, Accessibility, Problem Statement Alignment** — written by the author himself, presumably reflecting what the event actually told participants. Treat this as the best available signal on what's graded, not confirmed official (no public rubric was found).

That repo covers all 7 brief use cases with 295 tests, 100% coverage, bilingual UI, WCAG 2.2 AA, and live IndiaCode statute integration. Matching that from scratch solo in 24h is not realistic — attempting full parity and finishing none of it well is worse than finishing a narrower slice cleanly. So: 4 use cases, built with the same *pattern* (deterministic where possible, LLM only for language tasks, everything cited), not the same breadth.

**The one technique worth adopting wholesale:** never let the LLM do what deterministic code can do. Segment clauses with stable IDs *before* calling the model. Constrain the model to strict schema output. Verify every citation the model returns against the real clause IDs; silently drop anything invented. This is what separates a credible tool from a hallucinating chat wrapper, and it directly answers the brief's own caution ("provide information and assistance, rather than replace professional legal advice").

## Scope: 4 use cases (in build order — each phase should leave a working demo)

1. **Simplify** — upload a document, get a plain-language summary + key terms, every sentence linked to the clause it came from.
2. **Highlight risks & obligations** — obligations extracted with their stated deadline text; risk flags with severity (Low/Medium/High/Critical); everything tied to a clause ID.
3. **Grounded Q&A** — user asks questions about the uploaded document; answers cite clause IDs; document text is treated as data, not instructions (prompt-injection screen on the question field).
4. **Lawyer-prep export** — one-click brief combining: situation summary, top risks with citations, computed deadlines, and 5 tailored questions to bring to a lawyer. Covers both "understand next steps" and "prepare for a legal professional" from the brief in one artifact.

**Explicitly out of scope for the deadline** (add only if all 4 phases are done, tested, and deployed with time to spare):
- Contract comparison (`/compare`) — real feature, but needs a second-document upload flow + diff engine; too much surface area to add safely this late.
- Live statute grounding (IndiaCode API or equivalent) — good pattern, but an external API dependency risks breaking automated grading on timeout/downtime. If added, it must degrade silently (no match → simply omit the citation, never error).
- Bilingual UI, OCR/scanned-image input, full WCAG audit — real quality signals but not worth the hours against a 24h clock when the 4 core use cases aren't done yet.

## Architecture

```
Upload (PDF text only for MVP — no OCR/image support yet)
        │
Deterministic clause segmentation → stable IDs (SEC-01, SEC-02, ...)
        │
   ┌────┴────┬──────────────┬─────────────────┐
   ▼         ▼              ▼                 ▼
Simplify   Risk/Obligation  Q&A            Lawyer-prep export
(LLM,      (LLM, strict     (LLM + clause  (reuses outputs from
 strict    schema)          context,       the other 3, no new
 schema)                    citation-      LLM calls if already
                            verified)      run)
   │         │              │                 │
   └────┬────┴──────────────┴─────────────────┘
        ▼
Citation verification gate (drop any clause ID the model invented;
show a verified/discarded count if easy, skip if not)
        ▼
Deadline arithmetic (deterministic date math from user-entered anchor
dates, not model-generated dates)
```

## Tech stack (fast, low-risk, proven by the top scorer)

- **Framework:** Next.js (App Router) + TypeScript
- **LLM:** Gemini via Vercel AI SDK (`@ai-sdk/google`). One primary model + **one** fallback tier — do not build a 4-model fallback chain, that's over-engineering for a 24h build; a single fallback covers the realistic rate-limit risk.
- **Validation:** Zod, strict schemas on every model response. A response that fails validation is a failed generation — retry once, then surface a clear error, never render unvalidated output.
- **Testing:** Vitest. Prioritize coverage on the deterministic modules (segmentation, citation verification, deadline arithmetic) — that's where tests are cheap and where "Testing" credit is easiest to earn. Don't chase 100% UI coverage; there isn't time.
- **Deploy:** Do NOT deploy. The coordinator (Claude Code) handles deployment separately once code is ready — just make sure `npm run build` succeeds and the app runs cleanly with `npm run dev`, and note in `STATUS.md` when it's ready to be deployed.
- **Gemini API key tier:** Use a **paid-tier** Gemini key for the app's runtime calls, not the free tier — on the free tier Google uses prompts/responses to improve its products, on paid tier it explicitly doesn't (this is exactly why ClauseSaathi's README calls out using the paid tier). Ask the coordinator for the key if one isn't already in `.env.local`; don't hardcode a fallback to the free tier.
- **Security (minimum viable, not the full threat model):** Zod-validated request bodies, a basic file-type/size check on upload, a simple in-memory or edge rate limiter (skip Redis unless trivial to wire up). Treat document text and user questions as data in prompts, never as instructions — a one-line system prompt note plus keeping document text inside a delimited block is enough; don't build a separate topic-gate model call unless time remains.

## Phase checklist (report status against this)

- [ ] **Phase 0 — Scaffold:** Next.js + TS + Zod + Vitest wired up, Gemini key working locally (`npm run dev`), builds cleanly (`npm run build`). *(Do this first, and flag it done in STATUS.md immediately — the coordinator will deploy from here so there's a live fallback URL early.)*
- [ ] **Phase 1 — Simplify:** upload → segment → LLM summary (schema-validated) → citation-verified render. Demoable end to end.
- [ ] **Phase 2 — Risk & Obligations:** extend schema for risk flags + obligations; deterministic deadline computation from user-entered anchor date.
- [ ] **Phase 3 — Grounded Q&A:** question input → answer grounded in segmented clauses, citation-verified, basic prompt-injection guard on the question field.
- [ ] **Phase 4 — Lawyer-prep export + hardening:** one-click brief generator; Vitest suite on deterministic modules; basic input validation/rate limiting; redeploy; smoke-test the full flow on a real (synthetic) sample document.
- [ ] **Stretch (only if time remains):** contract comparison, statute grounding, OCR, bilingual.

Ship a synthetic sample document (e.g. a rent agreement) bundled in the repo so the demo doesn't depend on finding a real document live.

## Reporting back — `STATUS.md`

After each phase (or if blocked), append to `STATUS.md` in this folder:

```markdown
## [timestamp] Phase N — <status: done|blocked|in-progress>
- What works:
- What's broken/incomplete:
- Blockers needing a decision from the coordinator:
- Live URL (if deployed):
```

Keep it short — this is for the coordinator to triage quickly against the clock, not a full writeup.
