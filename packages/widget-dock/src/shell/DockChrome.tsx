// SPDX-License-Identifier: Apache-2.0
/**
 * Top bar that sits above every dock view. Hosts the brand mark, the
 * connection indicator, a layout-mode toggle, and a settings dropdown.
 *
 * Kept thin — anything that's per-route lives in the route component,
 * not here.
 */

import { PinMark } from '@pinagent/ui/components/pin-mark';
import { Button } from '@pinagent/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pinagent/ui/components/ui/dropdown-menu';
import { cn } from '@pinagent/ui/lib/utils';
import { Maximize2, Minimize2, MoreHorizontal, PanelRight, WifiOff } from 'lucide-react';
import type { DockMode } from './useDockMode';

export interface DockChromeProps {
  mode: DockMode;
  onModeChange: (mode: DockMode) => void;
  onClose: () => void;
  /** When true, render a WifiOff indicator with a tooltip-y label. */
  disconnected?: boolean;
  /** Short status text shown next to the brand (e.g. project name). */
  context?: string;
}

const MODE_ORDER: readonly DockMode[] = ['panel', 'floating', 'fullscreen'];
const MODE_LABEL: Record<DockMode, string> = {
  panel: 'Panel',
  floating: 'Floating',
  fullscreen: 'Fullscreen',
};
const MODE_ICON = {
  panel: PanelRight,
  floating: MoreHorizontal,
  fullscreen: Maximize2,
} as const;

export function DockChrome({
  mode,
  onModeChange,
  onClose,
  disconnected = false,
  context,
}: DockChromeProps) {
  const NextIcon = mode === 'fullscreen' ? Minimize2 : Maximize2;
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

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              aria-label="Dock layout"
              title={`Layout: ${MODE_LABEL[mode]}`}
            >
              <NextIcon className="h-4 w-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              Layout
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {MODE_ORDER.map((m) => {
              const Icon = MODE_ICON[m];
              return (
                <DropdownMenuItem
                  key={m}
                  onSelect={() => onModeChange(m)}
                  className={cn(
                    'gap-2 text-sm',
                    m === mode && 'bg-secondary text-secondary-foreground',
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {MODE_LABEL[m]}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label="Close dock"
          onClick={onClose}
        >
          <Minimize2 className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </header>
  );
}
