// SPDX-License-Identifier: Apache-2.0
/**
 * Settings — read-only display of per-project configuration. Saves land
 * with Phase 5; until then, inputs render disabled so the schema and
 * defaults are visible without inviting edits that won't persist.
 */

import { Badge } from '@pinagent/ui/components/ui/badge';
import { Input } from '@pinagent/ui/components/ui/input';
import { cn } from '@pinagent/ui/lib/utils';
import type { ReactNode } from 'react';
import { FIXTURE_SETTINGS, type ProjectSettings } from '../fixtures';

const PERMISSION_LABEL: Record<ProjectSettings['permissionMode'], string> = {
  auto: 'Auto-accept edits',
  approve: 'Require approval',
  'dry-run': 'Dry-run only',
};

const PERMISSION_DESCRIPTION: Record<ProjectSettings['permissionMode'], string> = {
  auto: 'Agent edits land in the worktree without confirmation.',
  approve: 'Each edit pauses for your approval before applying.',
  'dry-run': 'Agents propose but never write. Useful for review-only setups.',
};

export function Settings() {
  const s = FIXTURE_SETTINGS;

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Read-only · saving config lands with Phase 5.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        <SettingsGroup title="Git">
          <Field label="Base branch" description="Worktrees branch off this. PRs target it.">
            <Input value={s.baseBranch} disabled className="h-8 max-w-[260px] font-mono text-xs" />
          </Field>
          <Field
            label="Worktree retention"
            description="Inactive worktrees are pruned after this many days."
          >
            <div className="flex items-center gap-2">
              <Input
                value={String(s.worktreeRetentionDays)}
                disabled
                inputMode="numeric"
                className="h-8 w-20 tabular-nums text-xs"
              />
              <span className="text-[11px] text-muted-foreground">days</span>
            </div>
          </Field>
        </SettingsGroup>

        <SettingsGroup title="Cost controls">
          <Field label="Per-conversation cap" description="Hard ceiling. Agents stop when reached.">
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">$</span>
              <Input
                value={s.perConversationCapUsd.toFixed(2)}
                disabled
                className="h-8 w-24 tabular-nums text-xs"
              />
            </div>
          </Field>
          <Field
            label="Monthly project budget"
            description="Soft ceiling — surfaces a warning in Connections when crossed."
          >
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">$</span>
              <Input
                value={s.monthlyBudgetUsd === null ? '' : s.monthlyBudgetUsd.toFixed(2)}
                placeholder="None"
                disabled
                className="h-8 w-24 tabular-nums text-xs"
              />
            </div>
          </Field>
        </SettingsGroup>

        <SettingsGroup title="Permission mode">
          <div className="space-y-1.5">
            {(Object.keys(PERMISSION_LABEL) as ProjectSettings['permissionMode'][]).map((mode) => {
              const active = mode === s.permissionMode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled
                  className={cn(
                    'w-full text-left rounded-md border px-3 py-2 transition-colors',
                    'disabled:cursor-not-allowed',
                    active
                      ? 'border-foreground/40 bg-secondary/60'
                      : 'border-border bg-card opacity-60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {PERMISSION_LABEL[mode]}
                    </span>
                    {active && (
                      <Badge variant="outline" className="text-[10px]">
                        current
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {PERMISSION_DESCRIPTION[mode]}
                  </p>
                </button>
              );
            })}
          </div>
        </SettingsGroup>
      </div>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="px-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {children}
      </div>
    </section>
  );
}

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground">{label}</p>
        {description && (
          <p className="mt-0.5 text-[11px] text-muted-foreground leading-relaxed">{description}</p>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
