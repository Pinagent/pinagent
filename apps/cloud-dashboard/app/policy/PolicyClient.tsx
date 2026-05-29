// SPDX-License-Identifier: Elastic-2.0
'use client';

import { useMemo } from 'react';
import { createCloudApiClient } from '../../src/api-client';
import { Policy } from '../../src/Policy';

/** Client boundary: policy reads run in the browser so they carry the cookie. */
export function PolicyClient({ organizationId }: { organizationId: string }) {
  const client = useMemo(() => createCloudApiClient(), []);
  return <Policy client={client} organizationId={organizationId} />;
}
