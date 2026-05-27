// SPDX-License-Identifier: Apache-2.0
import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

const BRAND_INK = '#201B21';
const BRAND_GOLD = '#FFD700';

const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';

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
