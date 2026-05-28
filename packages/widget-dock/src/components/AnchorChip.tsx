// SPDX-License-Identifier: Apache-2.0
/**
 * Compact anchor descriptor — shows `file:line:col` (truncated by the
 * filename) with optional selector preview underneath. Used in list
 * rows and conversation headers.
 *
 * Renders as a button that opens the location in VSCode (via the
 * `@pinagent/vscode-extension` URI bridge) when the loc parses as a
 * `file:line:col` anchor. Falls back to a non-interactive span when
 * the loc shape isn't recognized — keeps list rows safe to nest the
 * chip inside other click targets.
 */

import { cn } from '@pinagent/ui/lib/utils';
import { FileCode } from 'lucide-react';
import type { MouseEvent } from 'react';
import { openAnchorInVSCode, parseAnchorLoc } from '../lib/vscode-bridge';
import { useExtensionLaunch } from '../shell/ExtensionLaunch';

export interface AnchorChipProps {
  loc: string;
  selector?: string;
  className?: string;
  /** When true, omit the icon (for ultra-dense rows). */
  bare?: boolean;
}

function shortFile(loc: string): string {
  // `src/marketing/Hero.tsx:42:8` → `Hero.tsx:42`
  const [path, line] = loc.split(':');
  const filename = path?.split('/').pop() ?? path ?? '';
  return line ? `${filename}:${line}` : filename;
}

const baseChipClass = cn(
  'inline-flex items-center gap-1 rounded-md',
  'bg-secondary/70 px-1.5 py-0.5',
  'font-mono text-[10.5px] text-muted-foreground',
  'border border-transparent transition-colors',
  'max-w-full min-w-0',
);

export function AnchorChip({ loc, selector, className, bare = false }: AnchorChipProps) {
  const { attemptLaunch } = useExtensionLaunch();
  const canOpen = parseAnchorLoc(loc) !== null;
  const tooltip = selector ? `${loc} — ${selector}` : loc;
  const body = (
    <>
      {!bare && <FileCode className="h-3 w-3 shrink-0" aria-hidden />}
      <span className="truncate">{shortFile(loc)}</span>
    </>
  );

  if (!canOpen) {
    return (
      <span title={tooltip} className={cn(baseChipClass, 'hover:border-border', className)}>
        {body}
      </span>
    );
  }

  // Stop propagation so the chip can sit inside ListRow / DetailHeader
  // click targets without also triggering their "open this row" handlers.
  const onClick = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    attemptLaunch(() => openAnchorInVSCode(loc));
  };

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${tooltip} — open in VSCode`}
      aria-label={`Open ${loc} in VSCode`}
      className={cn(
        baseChipClass,
        'cursor-pointer hover:border-border hover:bg-secondary',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        className,
      )}
    >
      {body}
    </button>
  );
}
