// SPDX-License-Identifier: Apache-2.0
import { BRAND_GOLD, BRAND_INK, PIN_PATH } from '@pinagent/ui/tokens';
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: BRAND_GOLD,
      }}
    >
      <svg
        width="120"
        height="120"
        viewBox="0 0 93 93"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d={PIN_PATH} fill={BRAND_INK} />
      </svg>
    </div>,
    { ...size },
  );
}
