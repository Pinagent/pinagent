// SPDX-License-Identifier: Elastic-2.0
import { Body, Container, Head, Hr, Html, Preview, Section, Text } from '@react-email/components';
import type { ReactNode } from 'react';

/**
 * Brand palette, inlined here on purpose. Email clients don't run Tailwind or
 * CSS custom properties, so we can't reuse `@pinagent/ui`'s themed tokens —
 * every value has to be a literal inline style. Mirrors
 * `packages/ui/src/tokens.ts` (BRAND_INK / BRAND_CREAM / BRAND_GOLD).
 */
export const BRAND = {
  ink: '#201B21',
  cream: '#FCF9E8',
  gold: '#FFD700',
  muted: '#6B6470',
  name: 'Pinagent',
} as const;

export const fontFamily =
  '"Geist", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif';

/**
 * Shared branded shell for every transactional email: a cream page, a centered
 * card, the Pinagent wordmark header, the email body, and a muted footer.
 * Templates supply `preview` (inbox snippet) + their content as `children`.
 */
export function Layout({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: BRAND.cream, margin: 0, padding: '24px 0', fontFamily }}>
        <Container
          style={{
            backgroundColor: '#ffffff',
            border: `1px solid ${BRAND.ink}1a`,
            borderRadius: 12,
            maxWidth: 480,
            margin: '0 auto',
            overflow: 'hidden',
          }}
        >
          <Section style={{ backgroundColor: BRAND.ink, padding: '20px 32px' }}>
            <Text
              style={{
                color: BRAND.cream,
                fontFamily,
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: '-0.01em',
                margin: 0,
              }}
            >
              {BRAND.name}
            </Text>
          </Section>
          <Section style={{ padding: '32px' }}>{children}</Section>
          <Hr style={{ borderColor: `${BRAND.ink}14`, margin: 0 }} />
          <Section style={{ padding: '20px 32px' }}>
            <Text
              style={{
                color: BRAND.muted,
                fontFamily,
                fontSize: 12,
                lineHeight: '18px',
                margin: 0,
              }}
            >
              You received this email because someone added your address on {BRAND.name}. If you
              weren't expecting it, you can safely ignore this message.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
