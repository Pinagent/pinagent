// SPDX-License-Identifier: Apache-2.0
import type { ComponentType, ReactNode, SVGAttributes } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@pinagent/ui/lib/utils';

export interface EmptyStateProps {
  title: string;
  description?: ReactNode;
  Icon?: ComponentType<SVGAttributes<SVGSVGElement>>;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      <div
        aria-hidden
        className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground"
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground max-w-[28ch] mx-auto leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
