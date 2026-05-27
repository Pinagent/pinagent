// SPDX-License-Identifier: Apache-2.0
/**
 * The dock's floating-action button. Distinct from the per-element
 * picker FAB (per spec — primary entry points shouldn't compete with
 * long-press affordances). Sits bottom-left by default; the picker FAB
 * lives bottom-right.
 *
 * Count badge: gold dot over the pin when there are pending changes
 * the user should look at. Reads `count` as a number; renders the
 * badge for any value > 0.
 */
import { forwardRef } from 'react';
import { PinMark } from '@pinagent/ui/components/pin-mark';
import { cn } from '@pinagent/ui/lib/utils';

export interface DockFABProps {
  open: boolean;
  count?: number;
  onToggle: () => void;
  /** Override the corner placement (default: bottom-left). */
  className?: string;
}

export const DockFAB = forwardRef<HTMLButtonElement, DockFABProps>(
  ({ open, count = 0, onToggle, className }, ref) => {
    const hasBadge = count > 0;
    return (
      <button
        ref={ref}
        type="button"
        onClick={onToggle}
        aria-label={open ? 'Close Pinagent dock' : 'Open Pinagent dock'}
        aria-pressed={open}
        className={cn(
          'fixed bottom-5 left-5 z-[2147483647]',
          'flex h-12 w-12 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground',
          'shadow-[0_10px_28px_rgba(32,27,33,0.28)]',
          'transition-transform duration-150 ease-out',
          'hover:scale-[1.06] active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/60',
          open && 'ring-[3px] ring-accent/80',
          className,
        )}
      >
        <PinMark size={22} tone="cream" />
        {hasBadge && (
          <span
            aria-label={`${count} pending`}
            className={cn(
              'absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1.5 rounded-full',
              'bg-accent text-accent-foreground text-[10px] font-semibold leading-none',
              'flex items-center justify-center',
              'shadow-[0_2px_6px_rgba(32,27,33,0.18)]',
              'ring-2 ring-background',
            )}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
    );
  },
);
DockFAB.displayName = 'DockFAB';
