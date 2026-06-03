// SPDX-License-Identifier: Elastic-2.0
import { Button } from '@react-email/components';
import type { CSSProperties, ReactNode } from 'react';
import { BRAND, fontFamily } from './Layout';

/** Shared inline text styles so every template reads consistently. */
export const styles = {
  heading: {
    color: BRAND.ink,
    fontFamily,
    fontSize: 22,
    fontWeight: 700,
    margin: '0 0 16px',
  } satisfies CSSProperties,
  paragraph: {
    color: BRAND.ink,
    fontFamily,
    fontSize: 15,
    lineHeight: '24px',
    margin: '0 0 16px',
  } satisfies CSSProperties,
  muted: {
    color: BRAND.muted,
    fontFamily,
    fontSize: 13,
    lineHeight: '20px',
    margin: '20px 0 0',
  } satisfies CSSProperties,
} as const;

/** The primary call-to-action button, styled in the brand ink/cream. */
export function CtaButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Button
      href={href}
      style={{
        backgroundColor: BRAND.ink,
        color: BRAND.cream,
        fontFamily,
        fontSize: 15,
        fontWeight: 600,
        borderRadius: 8,
        padding: '12px 20px',
        textDecoration: 'none',
      }}
    >
      {children}
    </Button>
  );
}
