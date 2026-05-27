// SPDX-License-Identifier: Apache-2.0
import { GitPullRequest, RotateCcw, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@pinagent/ui/components/ui/button';
import { StatusBadge } from '@pinagent/ui/components/status-badge';
import { cn } from '@pinagent/ui/lib/utils';
import { TimestampDot } from '../components/TimestampDot';
import { FIXTURE_CHANGES } from '../fixtures';

export function Changes() {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const ready = useMemo(() => FIXTURE_CHANGES.filter((c) => c.status === 'readyToLand'), []);
  const others = useMemo(() => FIXTURE_CHANGES.filter((c) => c.status !== 'readyToLand'), []);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Changes</h2>
        <span className="text-[11px] text-muted-foreground">
          {ready.length} ready · {others.length} other
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {selected.size > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {selected.size} selected
            </span>
          )}
          <Button
            size="sm"
            disabled={selected.size === 0}
            className="h-7 gap-1.5"
            variant={selected.size > 0 ? 'accent' : 'outline'}
          >
            <GitPullRequest className="h-3.5 w-3.5" />
            Create PR
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-1">
          Ready to land
        </div>
        {ready.map((c) => {
          const isSelected = selected.has(c.id);
          return (
            <article
              key={c.id}
              className={cn(
                'rounded-lg border border-border bg-card p-3',
                'transition-colors',
                isSelected && 'border-foreground/40 bg-secondary/60',
              )}
            >
              <div className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggle(c.id)}
                  aria-label={`Select ${c.conversationTitle}`}
                  className={cn(
                    'mt-1 h-3.5 w-3.5 shrink-0 rounded border-border',
                    'accent-foreground cursor-pointer',
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2">
                    <h3 className="flex-1 text-sm font-medium leading-tight text-foreground truncate">
                      {c.conversationTitle}
                    </h3>
                    <TimestampDot iso={c.updatedAt} />
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <StatusBadge status={c.status} variant="dot" />
                    <span>{c.filesChanged} file{c.filesChanged === 1 ? '' : 's'}</span>
                    <span className="text-status-ready-fg">+{c.additions}</span>
                    <span className="text-status-error-fg">−{c.deletions}</span>
                  </div>
                  <pre
                    className={cn(
                      'mt-2 rounded-md bg-secondary/50 border border-border',
                      'px-2.5 py-2 font-mono text-[11px] leading-relaxed text-foreground/85',
                      'overflow-x-auto whitespace-pre',
                    )}
                  >
                    {c.preview}
                  </pre>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
                    Land
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground"
                  >
                    <RotateCcw className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </article>
          );
        })}

        {others.length > 0 && (
          <>
            <div className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground px-1 pt-3">
              Not ready
            </div>
            {others.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-3 rounded-lg border border-border bg-card/40 px-3 py-2.5"
              >
                <StatusBadge status={c.status} variant="dot" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{c.conversationTitle}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{c.preview}</p>
                </div>
                <TimestampDot iso={c.updatedAt} />
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0">
                  <X className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
