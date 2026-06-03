// SPDX-License-Identifier: Apache-2.0
/**
 * Settings — editable per-project config. Reads via `GET /__pinagent/settings`,
 * patches via `PATCH /__pinagent/settings`. The form tracks a local
 * draft; Save flushes when dirty + valid. Cancel reverts to the
 * authoritative read.
 */

import { PROJECT_PERMISSION_MODES } from '@pinagent/shared';
import { Badge } from '@pinagent/ui/components/ui/badge';
import { Button } from '@pinagent/ui/components/ui/button';
import { Input } from '@pinagent/ui/components/ui/input';
import { cn } from '@pinagent/ui/lib/utils';
import { AlertTriangle } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useSettings, useUpdateSettings } from '../hooks/useSettings';
import {
  overrideProjectMode,
  permissionModeDisplay,
  permissionRowBadge,
} from '../lib/permissionMode';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import type { DockProjectSettings } from '../transport';

type PermissionMode = DockProjectSettings['permissionMode'];

export function Settings() {
  const settingsQuery = useSettings();

  if (settingsQuery.isLoading) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <div className="border-b border-border bg-card px-3 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
        </div>
        <LoadingState rows={4} />
      </div>
    );
  }

  if (settingsQuery.isError) {
    return (
      <div className="flex flex-1 flex-col min-h-0">
        <div className="border-b border-border bg-card px-3 py-2.5">
          <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
        </div>
        <ErrorState
          title="Couldn't load settings"
          description="The dock couldn't reach the local pinagent dev-server."
          onRetry={() => settingsQuery.refetch()}
        />
      </div>
    );
  }

  if (!settingsQuery.data) return null;
  return <SettingsForm key={JSON.stringify(settingsQuery.data)} initial={settingsQuery.data} />;
}

function SettingsForm({ initial }: { initial: DockProjectSettings }) {
  const updateMutation = useUpdateSettings();
  const [draft, setDraft] = useState<DockProjectSettings>(initial);

  // If a save lands while the form is mounted, rehydrate the draft from
  // the new authoritative read. The `key` on this component (parent
  // passes JSON of initial) handles the full-reset case; this guards
  // the in-place mutation success path.
  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  // The picker row an active env override resolves to (null = no override),
  // so we can mark "In force" vs the merely "Saved" selection.
  const overrideMode = overrideProjectMode(initial.permissionModeOverride);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const valid =
    draft.baseBranch.trim().length > 0 &&
    Number.isFinite(draft.worktreeRetentionDays) &&
    draft.worktreeRetentionDays >= 1 &&
    Number.isFinite(draft.perConversationCapUsd) &&
    draft.perConversationCapUsd > 0 &&
    (draft.monthlyBudgetUsd === null ||
      (Number.isFinite(draft.monthlyBudgetUsd) && draft.monthlyBudgetUsd >= 0));

  const onSave = (): void => {
    updateMutation.mutate(draft);
  };
  const onReset = (): void => {
    updateMutation.reset();
    setDraft(initial);
  };

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="border-b border-border bg-card px-3 py-2.5 flex items-center gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Settings</h2>
        <span className="text-[11px] text-muted-foreground">
          Stored at <code className="font-mono">.pinagent/config.json</code>
        </span>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        <SettingsGroup title="Git">
          <Field label="Base branch" description="Worktrees branch off this. PRs target it.">
            <Input
              value={draft.baseBranch}
              onChange={(e) => setDraft({ ...draft, baseBranch: e.target.value })}
              spellCheck={false}
              className="h-8 max-w-[260px] font-mono text-xs"
            />
          </Field>
          <Field
            label="Worktree retention"
            description="Inactive worktrees are pruned after this many days."
          >
            <div className="flex items-center gap-2">
              <Input
                value={String(draft.worktreeRetentionDays)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    worktreeRetentionDays: Number(e.target.value) || 0,
                  })
                }
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
                value={String(draft.perConversationCapUsd)}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    perConversationCapUsd: Number(e.target.value) || 0,
                  })
                }
                inputMode="decimal"
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
                value={draft.monthlyBudgetUsd === null ? '' : String(draft.monthlyBudgetUsd)}
                onChange={(e) => {
                  const v = e.target.value.trim();
                  setDraft({
                    ...draft,
                    monthlyBudgetUsd: v.length === 0 ? null : Number(v),
                  });
                }}
                placeholder="None"
                inputMode="decimal"
                className="h-8 w-24 tabular-nums text-xs"
              />
            </div>
          </Field>
        </SettingsGroup>

        <SettingsGroup title="Permission mode">
          {initial.permissionModeOverride && (
            <PermissionModeOverrideBanner mode={initial.permissionModeOverride} />
          )}
          <div className="space-y-1.5 p-2">
            {PROJECT_PERMISSION_MODES.map((meta) => {
              const active = meta.projectMode === draft.permissionMode;
              const badge = permissionRowBadge({
                rowMode: meta.projectMode,
                savedMode: draft.permissionMode,
                overrideMode,
              });
              return (
                <button
                  key={meta.projectMode}
                  type="button"
                  onClick={() =>
                    setDraft({ ...draft, permissionMode: meta.projectMode as PermissionMode })
                  }
                  className={cn(
                    'w-full text-left rounded-md border px-3 py-2 transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
                    active
                      ? 'border-foreground/40 bg-secondary/60'
                      : 'border-border bg-card hover:bg-secondary/40',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-foreground">{meta.label}</span>
                    {badge && (
                      <Badge
                        variant={badge === 'In force' ? 'default' : 'outline'}
                        className="text-[10px]"
                      >
                        {badge}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.description}</p>
                </button>
              );
            })}
          </div>
        </SettingsGroup>

        {updateMutation.isError && (
          <div className="flex items-start gap-2 rounded-md border border-status-error-border bg-status-error-bg px-3 py-2 text-[12px] text-status-error-fg">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="leading-snug">{updateMutation.error.message}</span>
          </div>
        )}
      </div>

      <div className="border-t border-border bg-card px-3 py-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {dirty ? 'Unsaved changes' : updateMutation.isSuccess ? 'Saved.' : 'No changes'}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onReset}
            disabled={!dirty || updateMutation.isPending}
          >
            Reset
          </Button>
          <Button
            size="sm"
            variant="accent"
            className="h-7 text-xs"
            onClick={onSave}
            disabled={!dirty || !valid || updateMutation.isPending}
          >
            {updateMutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shown inside the Permission mode group when
 * `PINAGENT_AGENT_PERMISSION_MODE` is set on the dev server. The picker
 * underneath still controls the persisted setting (useful for after
 * the env is unset), but every spawn until then resolves to the env
 * value.
 */
function PermissionModeOverrideBanner({ mode }: { mode: string }) {
  const display = permissionModeDisplay(mode);
  return (
    <div className="m-2 flex items-start gap-2 rounded-md border border-status-awaiting-border bg-status-awaiting-bg px-3 py-2 text-[12px] text-status-awaiting-fg">
      <AlertTriangle aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div className="leading-snug">
        <p className="font-medium">
          <code className="font-mono">PINAGENT_AGENT_PERMISSION_MODE</code> is set in this dev
          shell.
        </p>
        <p className="mt-0.5">
          Spawned agents run in <span className="font-semibold">{display.label}</span> mode (
          <code className="font-mono">{mode}</code>) regardless of your saved selection below. Unset
          the env var to use the saved setting.
        </p>
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
