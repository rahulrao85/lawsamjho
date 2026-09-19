import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "@/styles/govu-tokens.css";
import "./globals.css";
import { ThemeToggle } from "@/components/ThemeToggle";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

export const metadata: Metadata = {
  title: "LawSamjho — understand a legal document before you sign it",
  description:
    "Plain-language summaries, risk flags, obligations and grounded answers — every claim tied back to a clause ID in your own document.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        {/*
          Deliberately a plain <link> rather than next/font: next/font fetches
          from Google at BUILD time, which would make `npm run build` fail if the
          build machine is offline. A <link> cannot break the build, and the
          design system's font stack already falls back to system-ui.

          The lint rule below is a Pages Router relic -- it wants fonts in
          pages/_document.js, which App Router does not have.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap"
        />
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        {/* Visually hidden until focused -- the first tab stop for a keyboard
            or screen-reader user, letting them skip the nav on every page. */}
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>

        <header className="app-header no-print">
          <div className="app-header-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden="true">
                §
              </span>
              <span className="brand-text">
                LawSamjho
                <small>read it before you sign it</small>
              </span>
            </Link>
            <nav className="app-nav" aria-label="Main">
              <Link href="/simplify" className="nav-link">
                Simplify
              </Link>
              <Link href="/simplify?view=risks" className="nav-link">
                Risks &amp; obligations
              </Link>
              <Link href="/simplify?view=ask" className="nav-link">
                Ask
              </Link>
              <Link href="/simplify?view=brief" className="nav-link">
                Lawyer brief
              </Link>
            </nav>
            <ThemeToggle />
          </div>
        </header>

        <main id="main-content" className="container">
          {children}
        </main>

        <footer className="app-footer no-print">
          <p>
            LawSamjho explains documents. It is <strong>not</strong> legal advice and            does not replace a qualified lawyer. Every generated claim is linked to
            the clause it came from — check it there before acting on it.
          </p>
          <p>
            During this hackathon evaluation period, uploaded documents and usage may be
            retained on the server for development purposes.
          </p>
        </footer>
      </body>
    </html>
  );
}
