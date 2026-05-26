// SPDX-License-Identifier: Apache-2.0
import { BRAND_INK, BRAND_VIEWBOX, PIN_PATH } from '@pinagent/widget/brand';
import type { SVGProps } from 'react';

interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  size?: number;
  /**
   * `full` renders the brand mark on next-app's gold rounded tile —
   * a marketing-specific variant of the canonical cream square in
   * `@pinagent/widget/logo`. `mono` renders only the pin in
   * `currentColor` for inline use on coloured backgrounds.
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
      {variant === 'full' && <rect width="93" height="93" rx="16" fill="#FFD700" />}
      <path d={PIN_PATH} fill={variant === 'full' ? BRAND_INK : 'currentColor'} />
    </svg>
  );
}
