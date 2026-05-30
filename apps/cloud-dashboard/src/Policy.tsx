// SPDX-License-Identifier: Elastic-2.0

import type { BranchRoutingPolicy } from '@pinagent/ee-team-features';
import { Button } from '@pinagent/ui/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@pinagent/ui/components/ui/card';
import { useState } from 'react';
import type { CloudApiClient } from './api-client';
import { UnauthorizedError } from './api-client';
import { BranchRoutingForm } from './BranchRoutingForm';
import { KeyValue } from './KeyValue';
import { SignIn } from './SignIn';
import { LoadError, Loading } from './states';
import { useAsync } from './use-async';

export interface PolicyData {
  branchRouting: BranchRoutingPolicy | null;
}

/** Pure, render-only view — exercised directly in tests via renderToStaticMarkup. */
export function PolicyView({ branchRouting }: PolicyData) {
  const patterns = branchRouting?.allowedBranchPatterns ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Branch routing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!branchRouting ? (
          <p className="text-sm text-muted-foreground">
            No branch-routing policy — agents may target any branch.
          </p>
        ) : (
          <>
            <KeyValue
              rows={[
                {
                  label: 'Default base branch',
                  value: branchRouting.defaultBaseBranch ?? 'Repo default',
                },
              ]}
            />
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-medium text-muted-foreground">Allowed branch patterns</h3>
              {patterns.length === 0 ? (
                <p className="text-sm text-muted-foreground">Any branch is allowed.</p>
              ) : (
                <ul className="flex flex-wrap gap-2">
                  {patterns.map((pattern) => (
                    <li
                      key={pattern}
                      className="rounded-md bg-secondary px-2 py-1 font-mono text-xs text-secondary-foreground"
                    >
                      {pattern}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
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

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return <LoadError label="policy" error={state.error} />;
  }

  if (editing) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Edit branch routing</CardTitle>
        </CardHeader>
        <CardContent>
          <BranchRoutingForm
            initial={state.value.branchRouting}
            onSubmit={async (input) => {
              await client.putBranchRouting(organizationId, input);
              setEditing(false);
              setReloadKey((k) => k + 1);
            }}
            onCancel={() => setEditing(false)}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PolicyView branchRouting={state.value.branchRouting} />
      <div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          Edit policy
        </Button>
      </div>
    </div>
  );
}
