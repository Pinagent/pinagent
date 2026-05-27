// SPDX-License-Identifier: Apache-2.0
import { BRAND_CREAM, BRAND_GOLD, BRAND_INK, PIN_PATH, SURFACE_LIGHT } from '@pinagent/ui/tokens';
import { ImageResponse } from 'next/og';

export const OG_SIZE = { width: 1200, height: 630 };
export const OG_CONTENT_TYPE = 'image/png';

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
              borderLeft: `2px solid ${SURFACE_LIGHT.border}`,
              fontSize: 28,
              color: SURFACE_LIGHT.mutedForeground,
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
          color: SURFACE_LIGHT.mutedForeground,
        }}
      >
        <div style={{ display: 'flex' }}>github.com/Pinagent/pinagent</div>
        <div style={{ display: 'flex' }}>Apache-2.0</div>
      </div>
    </div>,
    { ...OG_SIZE },
  );
}
