// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Pinagent — click any element, comment, your coding agent fixes it',
  description:
    'A local Vite or Next.js plugin that hands UI feedback to Claude Code over MCP — with file:line and a screenshot attached.',
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
