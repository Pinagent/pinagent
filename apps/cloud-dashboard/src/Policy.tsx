// SPDX-License-Identifier: Elastic-2.0
import type { BranchRoutingPolicy } from '@pinagent/ee-team-features';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
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
  const state = useAsync<PolicyData>(async () => {
    const branchRouting = await client.getBranchRouting(organizationId);
    return { branchRouting };
  }, [client, organizationId]);

  if (state.status === 'loading') return <p className="loading">Loading…</p>;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return (
      <p className="error" role="alert">
        Failed to load policy: {String(state.error)}
      </p>
    );
  }
  return <PolicyView branchRouting={state.value.branchRouting} />;
}
