// SPDX-License-Identifier: Elastic-2.0
import type { ReactNode } from 'react';
import './globals.css';

const TITLE = 'Pinagent Cloud';
const DESCRIPTION = 'Admin dashboard for the Pinagent hosted control plane.';

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
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
