// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import './globals.css';

const TITLE = 'Pinagent — click any element, comment, your coding agent fixes it';
const DESCRIPTION =
  'A local Vite or Next.js plugin that hands UI feedback to Claude Code over MCP — with file:line and a screenshot attached.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    type: 'website',
    siteName: 'Pinagent',
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
