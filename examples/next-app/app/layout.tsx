// SPDX-License-Identifier: Apache-2.0
import { Pinagent } from '@pinagent/next-plugin';
import type { ReactNode } from 'react';
import { Logo } from './_components/Logo';
import { SideNav } from './_components/SideNav';
import './globals.css';

export const metadata = {
  title: 'Pinagent Next example',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="h-screen">
      <body className="m-0 bg-background font-sans text-foreground">
        <div className="flex min-h-screen">
          <aside className="sticky top-0 box-border h-screen w-60 shrink-0 self-start overflow-y-auto border-r border-border bg-background px-5 py-6">
            <div className="mb-5 flex items-center gap-2 text-[1.05rem] font-bold">
              <Logo size={22} />
              Pinagent
            </div>
            <SideNav />
          </aside>
          <div className="min-w-0 flex-1 bg-background">{children}</div>
        </div>
        <div
          aria-label="Pinagent logo"
          className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow"
        >
          <Logo size={16} variant="mono" />
          Pinagent
        </div>
        <Pinagent />
      </body>
    </html>
  );
}
