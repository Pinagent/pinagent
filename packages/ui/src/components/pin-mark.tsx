// SPDX-License-Identifier: Apache-2.0
/**
 * Pinagent's teardrop pin logo as a sized React component.
 *
 * Wraps the canonical PIN_PATH from @pinagent/ui/tokens so every
 * surface — dock chrome, marketing pages, FAB — renders the same mark.
 * Cream-on-ink by default; pass `tone="ink"` for ink-on-cream surfaces.
 */
import { forwardRef, type SVGAttributes } from 'react';
import { cn } from '../lib/utils';
import { BRAND_CREAM, BRAND_GOLD, BRAND_INK, BRAND_VIEWBOX, PIN_PATH } from '../tokens';

const SIZE = {
  xs: 14,
  sm: 18,
  md: 24,
  lg: 32,
  xl: 48,
} as const;

export type PinMarkSize = keyof typeof SIZE;
export type PinMarkTone = 'ink' | 'cream' | 'gold';

export interface PinMarkProps
  extends Omit<SVGAttributes<SVGSVGElement>, 'width' | 'height' | 'fill'> {
  size?: PinMarkSize | number;
  /** Pin fill color. `ink` = #201B21, `cream` = #FCF9E8, `gold` = #FFD700. */
  tone?: PinMarkTone;
  /** Stroke color around the pin (use when the pin sits on a same-tone surface). */
  stroke?: string;
  strokeWidth?: number;
}

const TONE: Record<PinMarkTone, string> = {
  ink: BRAND_INK,
  cream: BRAND_CREAM,
  gold: BRAND_GOLD,
};

export const PinMark = forwardRef<SVGSVGElement, PinMarkProps>(
  ({ size = 'md', tone = 'ink', stroke, strokeWidth = 4, className, ...rest }, ref) => {
    const pixelSize = typeof size === 'number' ? size : SIZE[size];
    return (
      <svg
        ref={ref}
        width={pixelSize}
        height={pixelSize}
        viewBox={BRAND_VIEWBOX}
        xmlns="http://www.w3.org/2000/svg"
        role="img"
        aria-label="Pinagent"
        className={cn('inline-block', className)}
        {...rest}
      >
        <path
          d={PIN_PATH}
          fill={TONE[tone]}
          stroke={stroke}
          strokeWidth={stroke ? strokeWidth : 0}
          strokeLinejoin="round"
        />
      </svg>
    );
  },
);
PinMark.displayName = 'PinMark';
