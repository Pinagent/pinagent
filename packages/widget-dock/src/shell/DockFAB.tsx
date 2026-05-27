// SPDX-License-Identifier: Apache-2.0
/**
 * The dock's floating-action button. Distinct from the per-element
 * picker FAB (per spec — primary entry points shouldn't compete with
 * long-press affordances). Draggable to any of the four viewport
 * corners; corner persists per browser.
 *
 * Count badge: gold dot over the pin when there are pending changes
 * the user should look at. Reads `count` as a number; renders the
 * badge for any value > 0.
 */

import { PinMark } from '@pinagent/ui/components/pin-mark';
import { cn } from '@pinagent/ui/lib/utils';
import { forwardRef } from 'react';
import { type FabCorner, useDraggableFAB } from './useDraggableFAB';

export interface DockFABProps {
  open: boolean;
  count?: number;
  onToggle: () => void;
  /** Initial corner if nothing's been persisted yet. */
  initialCorner?: FabCorner;
}

export const DockFAB = forwardRef<HTMLButtonElement, DockFABProps>(
  ({ open, count = 0, onToggle, initialCorner = 'bl' }, ref) => {
    const hasBadge = count > 0;
    const drag = useDraggableFAB(initialCorner);
    return (
      <button
        ref={ref}
        type="button"
        onMouseDown={drag.onMouseDown}
        onClick={drag.guardClick(onToggle)}
        aria-label={open ? 'Close Pinagent dock' : 'Open Pinagent dock'}
        aria-pressed={open}
        style={{ ...drag.style, position: 'fixed' }}
        className={cn(
          'z-[2147483647]',
          'flex h-12 w-12 items-center justify-center rounded-full',
          'bg-primary text-primary-foreground',
          'shadow-[0_10px_28px_rgba(32,27,33,0.28)]',
          'transition-transform duration-150 ease-out motion-reduce:transition-none',
          drag.dragging
            ? 'cursor-grabbing scale-[1.08]'
            : 'cursor-grab hover:scale-[1.06] active:scale-[0.98] motion-reduce:hover:scale-100 motion-reduce:active:scale-100',
          'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/60',
          open && 'ring-[3px] ring-accent/80',
        )}
      >
        <PinMark size={22} tone="cream" />
        {hasBadge && (
          <span
            role="status"
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
