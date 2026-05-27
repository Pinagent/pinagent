// SPDX-License-Identifier: Apache-2.0
import { Terminal, WifiOff } from 'lucide-react';
import { cn } from '@pinagent/ui/lib/utils';

export interface DisconnectedStateProps {
  /** Override the suggested command shown in the code block. */
  command?: string;
  className?: string;
}

export function DisconnectedState({
  command = 'pnpm dev',
  className,
}: DisconnectedStateProps) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-status-anchor-lost-bg text-status-anchor-lost-fg border border-dashed border-status-anchor-lost-border"
      >
        <WifiOff className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">Pinagent dev server isn’t running</h3>
        <p className="text-xs text-muted-foreground max-w-[36ch] mx-auto leading-relaxed">
          The dock needs a local pinagent server to read conversations. Start it from your project
          root:
        </p>
      </div>
      <code
        className={cn(
          'mt-1 inline-flex items-center gap-2 rounded-md',
          'bg-secondary px-3 py-1.5 font-mono text-xs',
          'border border-border',
        )}
      >
        <Terminal className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {command}
      </code>
    </div>
  );
}
