// SPDX-License-Identifier: Apache-2.0
/**
 * The dock surface — the box that appears when the FAB is clicked. One
 * component handles all three layout modes (panel, floating, fullscreen)
 * by swapping a wrapper className. Internal content (chrome + nav rail +
 * active route) is identical across modes.
 *
 * `embedded` toggles a Tailwind data-attr so the dock can scope styles
 * for the embedded-iframe case (extra shadow, rounded corners). When
 * the dock ships standalone, set embedded={false}.
 */

import { cn } from '@pinagent/ui/lib/utils';
import type { ReactNode } from 'react';
import type { DockMode } from './useDockMode';

export interface DockSurfaceProps {
  open: boolean;
  mode: DockMode;
  embedded?: boolean;
  /** Side the panel anchors to in `panel` mode (default: right). */
  side?: 'left' | 'right';
  children: ReactNode;
}

const MODE_WRAPPER: Record<DockMode, string> = {
  panel: cn(
    'fixed top-0 bottom-0 w-[480px] max-w-[100vw]',
    'flex flex-col bg-card text-foreground border-border',
    'shadow-[0_24px_56px_rgba(32,27,33,0.28)]',
    'transition-transform duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
    'motion-reduce:transition-none',
  ),
  floating: cn(
    'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
    'w-[min(600px,calc(100vw-2rem))] h-[min(800px,calc(100vh-2rem))]',
    'flex flex-col bg-card text-foreground rounded-xl border border-border overflow-hidden',
    'shadow-[0_24px_56px_rgba(32,27,33,0.32)]',
    'transition-opacity duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
    'motion-reduce:transition-none',
  ),
  fullscreen: cn(
    'fixed inset-0',
    'flex flex-col bg-background text-foreground',
    'transition-opacity duration-[220ms] ease-[cubic-bezier(0.2,0.8,0.2,1)]',
    'motion-reduce:transition-none',
  ),
};

const PANEL_SIDE = {
  right: cn('right-0 border-l data-[open=false]:translate-x-full'),
  left: cn('left-0 border-r data-[open=false]:-translate-x-full'),
};

export function DockSurface({
  open,
  mode,
  embedded = true,
  side = 'right',
  children,
}: DockSurfaceProps) {
  // Floating/fullscreen don't render when closed (no slide-in animation).
  // Panel renders always so it can slide off-screen.
  if (mode !== 'panel' && !open) return null;

  const sideClass = mode === 'panel' ? PANEL_SIDE[side] : '';
  const closedClass =
    mode === 'panel' ? '' : open ? 'opacity-100' : 'opacity-0 pointer-events-none';

  return (
    <>
      {(mode === 'floating' || mode === 'fullscreen') && open && (
        <div
          aria-hidden
          className={cn(
            'fixed inset-0 z-[2147483645]',
            mode === 'fullscreen' ? 'bg-background' : 'bg-foreground/20 backdrop-blur-sm',
          )}
        />
      )}
      <section
        role="dialog"
        aria-label="Pinagent dock"
        data-open={open}
        data-embedded={embedded}
        data-mode={mode}
        className={cn(
          'z-[2147483646]',
          MODE_WRAPPER[mode],
          sideClass,
          closedClass,
          // Embedded extras: subtle rounding on panel mode.
          mode === 'panel' && embedded && side === 'right' && 'rounded-l-xl',
          mode === 'panel' && embedded && side === 'left' && 'rounded-r-xl',
        )}
      >
        {children}
      </section>
    </>
  );
}
