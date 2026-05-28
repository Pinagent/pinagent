// SPDX-License-Identifier: Apache-2.0

import { useNavigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ActivityRow } from '../components/ActivityRow';
import { AnchorChip } from '../components/AnchorChip';
import { ListRow } from '../components/ListRow';
import { useAuditLog } from '../hooks/useAuditLog';
import { useConversations } from '../hooks/useConversations';
import { EmptyState } from '../shell/states/EmptyState';
import { ErrorState } from '../shell/states/ErrorState';
import { LoadingState } from '../shell/states/LoadingState';
import { OnboardingState } from '../shell/states/OnboardingState';
import { useTransport } from '../transport';

function SectionHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 px-3 pt-4 pb-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      {hint && <span className="text-[11px] text-muted-foreground/70 font-mono">{hint}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}

export function Overview() {
  const transport = useTransport();
  const navigate = useNavigate();
  const conversations = useConversations();
  // Top 7 mirrors what the prior fixture strip showed. The History route
  // owns the full feed at limit 200; the Overview surface is a glance.
  const activity = useAuditLog({ limit: 7 });
  const isMock = transport.kind === 'mock';

  return (
    <div className="flex flex-1 flex-col">
      <SectionHeader title="Recent conversations" hint={isMock ? 'fixtures' : undefined} />

      {conversations.isLoading && <LoadingState rows={4} />}

      {conversations.isError && (
        <ErrorState
          title="Couldn't load conversations"
          description={
            <>
              The dock couldn't reach the local pinagent dev-server. Make sure your host app is
              running with the pinagent plugin, or append{' '}
              <code className="font-mono">?fixtures=on</code> to the URL to use the demo dataset.
            </>
          }
          onRetry={() => conversations.refetch()}
        />
      )}

      {conversations.isSuccess && conversations.data.length === 0 && <OnboardingState />}

      {conversations.isSuccess && conversations.data.length > 0 && (
        <div className="flex flex-col gap-1.5 px-3">
          {conversations.data.slice(0, 8).map((c) => (
            <ListRow
              key={c.id}
              status={c.status}
              title={c.title}
              onClick={() => navigate({ to: '/conversations', search: { id: c.id } })}
              meta={
                <>
                  {c.anchor.loc && <AnchorChip loc={c.anchor.loc} selector={c.anchor.selector} />}
                  {c.page && (
                    <span className="truncate font-mono text-[10.5px]">
                      {new URL(c.page).pathname}
                    </span>
                  )}
                </>
              }
              updatedAt={c.updatedAt}
            />
          ))}
        </div>
      )}

      <SectionHeader title="Recent activity" hint={isMock ? 'fixtures' : undefined} />
      {activity.isLoading ? (
        <LoadingState rows={3} />
      ) : activity.isError ? (
        <ErrorState
          title="Couldn't load activity"
          description="The audit feed didn't load. Conversations above might still be fresh."
          onRetry={() => activity.refetch()}
        />
      ) : (activity.data ?? []).length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Conversations created, landed, and discarded — plus PRs the composer opens — will appear here."
        />
      ) : (
        <ol className="flex flex-col gap-1 px-3 pb-4">
          {(activity.data ?? []).map((e) => (
            <ActivityRow key={e.id} event={e} />
          ))}
        </ol>
      )}

      <div className="mt-auto border-t border-border bg-secondary/30 px-3 py-2">
        <p className="text-[11px] text-muted-foreground">
          {isMock
            ? 'Fixtures · drop ?fixtures=on to read from a local pinagent dev-server.'
            : 'Live · refreshes on project events.'}
        </p>
      </div>
    </div>
  );
}
