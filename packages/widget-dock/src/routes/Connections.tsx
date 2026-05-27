// SPDX-License-Identifier: Apache-2.0
/**
 * Connections — read-only view of GitHub + Anthropic connection state.
 * Write actions (OAuth popup, BYO-key entry, disconnect) land with
 * Phase 5; their buttons render disabled here so the surface is
 * visually complete and the eventual capability is discoverable.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { cn } from '@pinagent/ui/lib/utils';
import { Check, KeyRound, Lock, Sparkles } from 'lucide-react';
import type { ComponentType, ReactNode, SVGAttributes } from 'react';
import {
  type AnthropicConnection,
  FIXTURE_ANTHROPIC,
  FIXTURE_GITHUB,
  type GitHubConnection,
} from '../fixtures';

export function Connections() {
  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Connections</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Read-only · OAuth + key entry ship with Phase 5.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        <GitHubCard data={FIXTURE_GITHUB} />
        <AnthropicCard data={FIXTURE_ANTHROPIC} />
      </div>
    </div>
  );
}

function GitHubMark(props: SVGAttributes<SVGSVGElement>) {
  // Lucide dropped brand icons in 1.x — inline the GitHub mark here so
  // the Connections card stays visually distinct without pulling in a
  // brand-icon package for one glyph.
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" role="img" aria-label="GitHub" {...props}>
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.57.1.78-.25.78-.55v-2.06c-3.2.7-3.87-1.35-3.87-1.35-.52-1.34-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.74.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.04 0 0 .97-.31 3.18 1.18a11.06 11.06 0 0 1 5.78 0c2.21-1.49 3.18-1.18 3.18-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.25 5.69.41.36.78 1.05.78 2.12v3.14c0 .3.21.66.79.55C20.21 21.38 23.5 17.08 23.5 12 23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function ConnectionCard({
  Icon,
  title,
  status,
  description,
  action,
  children,
}: {
  Icon: ComponentType<SVGAttributes<SVGSVGElement>>;
  title: string;
  status: ReactNode;
  description: string;
  action: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <header className="flex items-start gap-3 px-3 py-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-foreground"
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {status}
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground leading-relaxed">
            {description}
          </p>
        </div>
        {action}
      </header>
      {children && <div className="border-t border-border px-3 py-2.5">{children}</div>}
    </section>
  );
}

function GitHubCard({ data }: { data: GitHubConnection }) {
  return (
    <ConnectionCard
      Icon={GitHubMark}
      title="GitHub"
      status={
        data.connected ? (
          <Badge
            variant="outline"
            className="border-status-landed-border bg-status-landed-bg text-status-landed-fg"
          >
            <Check className="h-3 w-3" />
            Connected
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not connected
          </Badge>
        )
      }
      description={
        data.connected
          ? `Authorized as @${data.account}. PRs originate from this account.`
          : 'Connect your GitHub account so the dock can open PRs for landed conversations.'
      }
      action={
        <Button size="sm" variant="outline" disabled className="h-7 text-xs">
          {data.connected ? 'Disconnect' : 'Connect'}
        </Button>
      }
    >
      {data.connected && data.repos.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            Reachable repos
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {data.repos.map((repo) => (
              <li
                key={repo.name}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-2 py-1 text-[11px] font-mono"
              >
                {repo.private && (
                  <Lock className="h-3 w-3 text-muted-foreground" aria-label="private" />
                )}
                {repo.name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ConnectionCard>
  );
}

function AnthropicCard({ data }: { data: AnthropicConnection }) {
  const Icon = data.mode === 'managed' ? Sparkles : KeyRound;
  const usagePct =
    data.monthBudgetUsd && data.monthBudgetUsd > 0
      ? Math.min(100, (data.monthUsageUsd / data.monthBudgetUsd) * 100)
      : null;

  return (
    <ConnectionCard
      Icon={Icon}
      title="Anthropic"
      status={
        data.mode === 'managed' ? (
          <Badge
            variant="outline"
            className="border-status-landed-border bg-status-landed-bg text-status-landed-fg"
          >
            Managed compute
          </Badge>
        ) : data.keySet ? (
          <Badge
            variant="outline"
            className="border-status-landed-border bg-status-landed-bg text-status-landed-fg"
          >
            <Check className="h-3 w-3" />
            Key set
          </Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">
            Not set
          </Badge>
        )
      }
      description={
        data.mode === 'managed'
          ? 'Agents run on pinagent-managed compute. No API key required.'
          : data.keySet
            ? 'Your Anthropic API key is encrypted server-side. The dock never reads it back.'
            : 'Add an Anthropic API key so agents can run on your account.'
      }
      action={
        <Button size="sm" variant="outline" disabled className="h-7 text-xs">
          {data.keySet || data.mode === 'managed' ? 'Replace' : 'Add key'}
        </Button>
      }
    >
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-[11.5px]">
          <span className="text-muted-foreground">This month</span>
          <span className="tabular-nums font-medium text-foreground">
            ${data.monthUsageUsd.toFixed(2)}
            {data.monthBudgetUsd !== null && (
              <span className="text-muted-foreground"> / ${data.monthBudgetUsd}</span>
            )}
          </span>
        </div>
        {usagePct !== null && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                usagePct < 60
                  ? 'bg-status-landed-fg'
                  : usagePct < 85
                    ? 'bg-status-working-fg'
                    : 'bg-status-error-fg',
              )}
              style={{ width: `${usagePct}%` }}
            />
          </div>
        )}
      </div>
    </ConnectionCard>
  );
}
