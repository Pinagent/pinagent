// SPDX-License-Identifier: Elastic-2.0
'use client';

import { useMemo } from 'react';
import { createCloudApiClient } from '../../src/api-client';
import { Billing } from '../../src/Billing';

/** Client boundary: billing reads run in the browser so they carry the cookie. */
export function BillingClient({ organizationId }: { organizationId: string }) {
  const client = useMemo(() => createCloudApiClient(), []);
  return <Billing client={client} organizationId={organizationId} />;
}
