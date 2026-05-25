import type { ReactNode } from 'react';
import { Pinpoint } from '@pinpoint/next';
import { Logo } from './_components/Logo';
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
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontWeight: 700,
                fontSize: '1.05rem',
                marginBottom: 20,
              }}
            >
              <Logo size={22} />
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
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: 999,
            boxShadow: '0 1px 2px rgba(0,0,0,0.4)',
            fontWeight: 600,
            fontSize: '0.875rem',
            color: '#f9fafb',
            zIndex: 1000,
          }}
        >
          <Logo size={16} variant="mono" style={{ color: '#f9fafb' }} />
          Pinpoint
        </div>
        <Pinpoint />
      </body>
    </html>
  );
}
