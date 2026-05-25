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
              background: '#f5f5f5',
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
        <div
          aria-label="Pinpoint logo"
          style={{
            position: 'fixed',
            top: 16,
            right: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            background: '#ffffff',
            border: '1px solid #d1d5db',
            borderRadius: 999,
            boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            fontWeight: 600,
            fontSize: '0.875rem',
            color: '#111827',
            zIndex: 1000,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z"
              fill="#111827"
            />
          </svg>
          Pinpoint
        </div>
        <Pinpoint />
      </body>
    </html>
  );
}
