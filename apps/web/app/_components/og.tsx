// SPDX-License-Identifier: Apache-2.0
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

const BRAND_INK = '#201B21';
const BRAND_CREAM = '#FCF9E8';
const BRAND_GOLD = '#FFD700';
const BRAND_BORDER = '#E8DFB0';
const BRAND_MUTED_FOREGROUND = '#5C5546';

const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';

export function renderOgImage({ eyebrow, title }: { eyebrow?: string; title: string }) {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        width: '100%',
        height: '100%',
        padding: '80px',
        background: BRAND_CREAM,
        color: BRAND_INK,
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 80,
            height: 80,
            background: BRAND_GOLD,
            borderRadius: 16,
          }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 93 93"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
          >
            <path d={PIN_PATH} fill={BRAND_INK} />
          </svg>
        </div>
        <div style={{ display: 'flex', fontSize: 48, fontWeight: 600, letterSpacing: '-0.02em' }}>
          Pinagent
        </div>
        {eyebrow ? (
          <div
            style={{
              display: 'flex',
              marginLeft: 8,
              paddingLeft: 24,
              borderLeft: `2px solid ${BRAND_BORDER}`,
              fontSize: 28,
              color: BRAND_MUTED_FOREGROUND,
            }}
          >
            {eyebrow}
          </div>
        ) : null}
      </div>
      <div
        style={{
          display: 'flex',
          fontSize: 84,
          lineHeight: 1.05,
          fontWeight: 600,
          letterSpacing: '-0.03em',
          maxWidth: 1040,
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 24,
          color: BRAND_MUTED_FOREGROUND,
        }}
      >
        <div style={{ display: 'flex' }}>github.com/Pinagent/pinagent</div>
        <div style={{ display: 'flex' }}>Apache-2.0</div>
      </div>
    </div>,
    { ...OG_SIZE },
  );
}
