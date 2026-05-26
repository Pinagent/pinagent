import { BRAND_INK, BRAND_VIEWBOX, PIN_PATH } from '@pinagent/ui/brand';
import type { SVGProps } from 'react';

interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
  size?: number;
  /**
   * `full` renders the next-app marketing variant — gold rounded
   * tile, a deliberate departure from the canonical cream square
   * exported by `@pinagent/ui/components/ui/logo`. `mono` renders
   * just the pin in `currentColor` for inline use on coloured
   * backgrounds.
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
