import type { ReactNode } from 'react';
import { Pinpoint } from '@pinpoint/next';

export const metadata = {
  title: 'Pinpoint Next example',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#e5e7eb' }}>
        {children}
        <Pinpoint />
      </body>
    </html>
  );
}
