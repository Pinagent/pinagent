// SPDX-License-Identifier: Elastic-2.0
'use client';

import { Button } from '@pinagent/ui/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@pinagent/ui/components/ui/dropdown-menu';
import { useMemo } from 'react';
import { createCloudApiClient, type MyOrg } from '../../src/api-client';
import { activeOrgLabel, orgHref } from '../../src/org-switcher-model';
import { useAsync } from '../../src/use-async';

/**
 * Header control to view + switch the active organization. Reads the caller's
 * orgs from `/me/orgs`; each entry links to the same tab with a different
 * `?org=`. Renders gracefully before the list loads (the trigger shows the
 * active org id) and never blocks the page if the fetch fails.
 */
export function OrgSwitcher({ activeOrg, basePath }: { activeOrg: string; basePath: string }) {
  const client = useMemo(() => createCloudApiClient(), []);
  const state = useAsync<MyOrg[]>(() => client.getMyOrgs(), [client]);
  const orgs = state.status === 'done' ? state.value : [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="font-mono">
          {activeOrgLabel(orgs, activeOrg)}
          <span aria-hidden className="text-muted-foreground">
            ▾
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.length === 0 ? (
          <DropdownMenuItem disabled>No organizations</DropdownMenuItem>
        ) : (
          orgs.map((o) => (
            <DropdownMenuItem key={o.organizationId} asChild>
              <a href={orgHref(basePath, o.organizationId)}>
                {o.displayName}
                {o.organizationId === activeOrg ? (
                  <span aria-hidden className="ml-auto">
                    ✓
                  </span>
                ) : null}
              </a>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
