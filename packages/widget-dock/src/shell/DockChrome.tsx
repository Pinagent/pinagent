// SPDX-License-Identifier: Apache-2.0
/**
 * Top bar that sits above every dock view. Hosts the brand mark, the
 * connection indicator, and a close button.
 *
 * Kept thin — anything that's per-route lives in the route component,
 * not here.
 */

import { PinMark } from '@pinagent/ui/components/pin-mark';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { WifiOff, X } from 'lucide-react';

export interface DockChromeProps {
  onClose: () => void;
  /** When true, render a WifiOff indicator with a tooltip-y label. */
  disconnected?: boolean;
  /** Short status text shown next to the brand (e.g. project name). */
  context?: string;
}

export function DockChrome({ onClose, disconnected = false, context }: DockChromeProps) {
  return (
    <header
      className={cn(
        'flex items-center gap-2 border-b border-border bg-card px-3 py-2',
        'min-h-[44px]',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <PinMark size="sm" tone="ink" className="shrink-0" />
        <span className="text-sm font-semibold tracking-tight truncate">Pinagent</span>
        {context && (
          <>
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
            <span className="text-xs text-muted-foreground truncate font-mono">{context}</span>
          </>
        )}
      </div>

      <div className="ml-auto flex items-center gap-1">
        {disconnected && (
          <span
            role="status"
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5',
              'text-xs text-status-error-fg bg-status-error-bg border border-status-error-border',
            )}
          >
            <WifiOff className="h-3 w-3" aria-hidden />
            Disconnected
          </span>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Close dock"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </header>
  );
}
