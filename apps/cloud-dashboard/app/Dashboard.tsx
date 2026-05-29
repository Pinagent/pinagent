// SPDX-License-Identifier: Elastic-2.0
'use client';

import { useMemo } from 'react';
import { createCloudApiClient } from '../src/api-client';
import { Overview } from '../src/Overview';

/**
 * Client boundary for the dashboard: the control-plane reads run in the
 * browser so they carry the session cookie set by the SSO flow.
 */
export function Dashboard({ organizationId }: { organizationId: string }) {
  const client = useMemo(() => createCloudApiClient(), []);
  return <Overview client={client} organizationId={organizationId} />;
}
