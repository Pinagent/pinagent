// SPDX-License-Identifier: Elastic-2.0
'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { createCloudApiClient, type MyOrg, UnauthorizedError } from '../../src/api-client';
import { orgHref } from '../../src/org-switcher-model';
import { SignIn } from '../../src/SignIn';
import { LoadError, Loading } from '../../src/states';
import { useAsync } from '../../src/use-async';

/**
 * Shown when no `?org=` is selected: resolves the caller's organizations and
 * redirects to the first one, so the dashboard defaults to a usable org
 * instead of dead-ending. Falls back to a zero-state when the caller belongs
 * to no orgs, and to sign-in on a 401.
 */
export function OrgGate({ basePath }: { basePath: string }) {
  const router = useRouter();
  const client = useMemo(() => createCloudApiClient(), []);
  const state = useAsync<MyOrg[]>(() => client.getMyOrgs(), [client]);
  const first = state.status === 'done' ? state.value[0] : undefined;

  useEffect(() => {
    if (first) router.replace(orgHref(basePath, first.organizationId));
  }, [first, basePath, router]);

  if (state.status === 'loading') return <Loading />;
  if (state.status === 'error') {
    if (state.error instanceof UnauthorizedError) return <SignIn />;
    return <LoadError label="organizations" error={state.error} />;
  }
  if (state.value.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">You don’t belong to any organizations yet.</p>
    );
  }
  return <Loading />;
}
