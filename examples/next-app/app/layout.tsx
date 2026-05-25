import type { ReactNode } from 'react';
import { Pinpoint } from '@pinpoint/next';
import { SideNav } from './_components/SideNav';

export const metadata = {
  title: 'Pinpoint Next example',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={{ height: '100vh' }}>
      <body style={{ margin: 0, background: '#ffffff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', minHeight: '100vh' }}>
          <aside
            style={{
              width: 240,
              flexShrink: 0,
              background: '#ffffff',
              borderRight: '1px solid #d1d5db',
              padding: '24px 20px',
              boxSizing: 'border-box',
              position: 'sticky',
              top: 0,
              alignSelf: 'flex-start',
              height: '100vh',
              overflowY: 'auto',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: 20 }}>
              Pinpoint
            </div>
            <SideNav />
          </aside>
          <div style={{ flex: 1, minWidth: 0, background: '#ffffff' }}>{children}</div>
        </div>
        <Pinpoint />
      </body>
    </html>
  );
}
