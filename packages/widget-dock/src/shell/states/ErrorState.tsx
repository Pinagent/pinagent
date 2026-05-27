// SPDX-License-Identifier: Apache-2.0

import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ErrorStateProps {
  title?: string;
  description?: ReactNode;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  description = 'The dock couldn’t load this view. Retry, and if it keeps failing, check the dev-server logs.',
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-status-error-bg text-status-error-fg border border-status-error-border"
      >
        <TriangleAlert className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground max-w-[36ch] mx-auto leading-relaxed">
          {description}
        </p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
          Try again
        </Button>
      )}
    </div>
  );
}
