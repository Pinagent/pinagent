// SPDX-License-Identifier: Apache-2.0
import type { SVGProps } from 'react';
import { BRAND_CREAM, BRAND_INK, BRAND_VIEWBOX, PIN_PATH } from './brand';

export interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  size?: number;
  /**
   * `full` renders the brand mark with its cream square background.
   * `mono` renders only the pin in `currentColor` — use inline next
   * to text or on coloured backgrounds.
   */
  variant?: 'full' | 'mono';
}

export function Logo({ size = 24, variant = 'full', ...props }: LogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={BRAND_VIEWBOX}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {variant === 'full' && <rect width="93" height="93" fill={BRAND_CREAM} />}
      <path d={PIN_PATH} fill={variant === 'full' ? BRAND_INK : 'currentColor'} />
    </svg>
  );
}
