// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';

export function Footer() {
  return (
    <footer className="mt-14 flex flex-col gap-4 border-t border-border pt-6 text-[13px] leading-relaxed text-muted-foreground transition-colors hover:text-foreground">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div className="font-semibold text-foreground/80">Pinagent · Next demo</div>
        <nav className="flex gap-4">
          <FooterLink href="/">Home</FooterLink>
          <FooterLink href="/docs">Docs</FooterLink>
          <FooterLink href="https://github.com/JacksonMalloy/pinagent/issues">Issues</FooterLink>
        </nav>
      </div>
      <p className="m-0 max-w-xl">
        A demo for Pinagent — click any element on the page, leave a comment, and a coding agent
        picks it up with the exact file, line, and a screenshot of what you selected. The agent
        edits the source directly, so feedback turns into a diff instead of a ticket. Built to show
        the click-to-fix loop end to end in a real Next.js app.
      </p>
      <div className="text-xs text-muted-foreground/80">
        © {new Date().getFullYear()} Pinagent. Built for demos and smoke tests.
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="underline-offset-[3px] transition-colors hover:text-foreground hover:underline"
    >
      {children}
    </a>
  );
}
