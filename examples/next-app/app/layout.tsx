import type { ReactNode } from 'react';
import { Pinpoint } from '@pinpoint/next';

export const metadata = {
  title: 'Pinpoint Next example',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#f8fafc' }}>
        {children}
        <Pinpoint />
      </body>
    </html>
  );
}
