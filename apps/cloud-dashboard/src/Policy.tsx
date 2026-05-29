// SPDX-License-Identifier: Elastic-2.0

import type { BranchRoutingPolicy } from '@pinagent/ee-team-features';
import { useState } from 'react';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { BranchRoutingForm } from './BranchRoutingForm';
import { SignIn } from './SignIn';
import { useAsync } from './use-async';

export interface PolicyData {
  branchRouting: BranchRoutingPolicy | null;
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function PolicyView({ branchRouting }: PolicyData) {
  const patterns = branchRouting?.allowedBranchPatterns ?? [];
  return (
    <section className="panel">
      <h2>Branch routing</h2>
      {!branchRouting ? (
        <p className="empty">No branch-routing policy — agents may target any branch.</p>
      ) : (
        <>
          <dl className="kv">
            <div className="kv-row">
              <dt>Default base branch</dt>
              <dd>{branchRouting.defaultBaseBranch ?? 'Repo default'}</dd>
            </div>
          </dl>
          <h3>Allowed branch patterns</h3>
          {patterns.length === 0 ? (
            <p className="empty">Any branch is allowed.</p>
          ) : (
            <ul className="patterns">
              {patterns.map((pattern) => (
                <li key={pattern}>
                  <code>{pattern}</code>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Data-loading container. */
export function Policy({
  client,
  organizationId,
}: {
  client: CloudApiClient;
  organizationId: string;
}) {
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState(false);

  const state = useAsync<PolicyData>(async () => {
    const branchRouting = await client.getBranchRouting(organizationId);
    return { branchRouting };
  }, [client, organizationId, reloadKey]);

  if (state.status === 'loading') return <p className="loading">Loading…</p>;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return (
      <p className="error" role="alert">
        Failed to load policy: {String(state.error)}
      </p>
    );
  }

  if (editing) {
    return (
      <section className="panel">
        <h2>Branch routing</h2>
        <h3>Edit policy</h3>
        <BranchRoutingForm
          initial={state.value.branchRouting}
          onSubmit={async (input) => {
            await client.putBranchRouting(organizationId, input);
            setEditing(false);
            setReloadKey((k) => k + 1);
          }}
          onCancel={() => setEditing(false)}
        />
      </section>
    );
  }

  return (
    <>
      <PolicyView branchRouting={state.value.branchRouting} />
      <div className="panel-actions">
        <button type="button" onClick={() => setEditing(true)}>
          Edit policy
        </button>
      </div>
    </>
  );
}
