import type { SVGProps } from 'react';

/**
 * Shared Pinpoint pin path. Stays in lockstep with
 * `packages/widget/src/widget.ts::PIN_PATH` and `app/icon.svg`.
 */
const PIN_PATH =
  'M38.0761 27C24.2046 27 16.7486 43.8193 26.2852 53.7027L26.4587 53.8761L47.2659 74.6834L68.0732 53.8761L68.2466 53.7027C77.9567 43.8193 70.3273 27 56.4558 27L38.0761 27Z';

interface LogoProps extends Omit<SVGProps<SVGSVGElement>, 'viewBox'> {
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
      viewBox="0 0 93 93"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      {variant === 'full' && <rect width="93" height="93" fill="#FCF9E8" />}
      <path d={PIN_PATH} fill={variant === 'full' ? '#201B21' : 'currentColor'} />
    </svg>
  );
}
