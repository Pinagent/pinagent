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
          Pinpoint · Next demo
        </div>
        <nav style={{ display: 'flex', gap: 16 }}>
          <FooterLink href="https://github.com/JacksonMalloy/pinpoint">GitHub</FooterLink>
          <FooterLink href="https://github.com/JacksonMalloy/pinpoint/issues">Issues</FooterLink>
          <FooterLink href="/docs">Docs</FooterLink>
          <FooterLink href="/changelog">Changelog</FooterLink>
          <FooterLink href="/">Home</FooterLink>
        </nav>
      </div>
      <p style={{ margin: 0, maxWidth: 560 }}>
        A smoke-test playground for Pinpoint — the click-to-comment tool that turns in-browser
        feedback into agent-actionable tasks tied to the exact file and line of the element you
        selected.
      </p>
      <div style={{ fontSize: 12, color: '#9ca3af' }}>
        © {new Date().getFullYear()} Pinpoint. Built for demos and smoke tests.
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
