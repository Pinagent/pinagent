'use client';
import { useState } from 'react';

export function Footer() {
  const [hovered, setHovered] = useState(false);
  return (
    <footer
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        marginTop: 56,
        paddingTop: 24,
        borderTop: '1px solid #e5e7eb',
        color: hovered ? '#111827' : '#6b7280',
        fontSize: 13,
        lineHeight: 1.55,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        transition: 'color 150ms ease',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 600, color: hovered ? '#111827' : '#374151' }}>
          Pinagent · Next demo
        </div>
        <nav style={{ display: 'flex', gap: 16 }}>
          <FooterLink href="https://github.com/JacksonMalloy/pinagent/issues">Issues</FooterLink>
          <FooterLink href="/docs">Docs</FooterLink>
          <FooterLink href="/changelog">Changelog</FooterLink>
          <FooterLink href="/">Home</FooterLink>
        </nav>
      </div>
      <p style={{ margin: 0, maxWidth: 560 }}>
        A demo for Pinagent — click any element on the page, leave a comment, and a
        coding agent picks it up with the exact file, line, and a screenshot of what
        you selected. The agent edits the source directly, so feedback turns into a
        diff instead of a ticket. Built to show the click-to-fix loop end to end in a
        real Next.js app.
      </p>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        © {new Date().getFullYear()} Pinagent. Built for demos and smoke tests.
      </div>
    </footer>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  const [hovered, setHovered] = useState(false);
  return (
    <a
      href={href}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        color: hovered ? '#111827' : 'inherit',
        textDecoration: hovered ? 'underline' : 'none',
        textUnderlineOffset: 3,
        transition: 'color 150ms ease',
      }}
    >
      {children}
    </a>
  );
}
