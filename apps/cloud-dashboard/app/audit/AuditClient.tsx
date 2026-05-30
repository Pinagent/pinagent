// SPDX-License-Identifier: Elastic-2.0
'use client';

import { useMemo } from 'react';
import { Audit } from '../../src/Audit';
import { createCloudApiClient } from '../../src/api-client';

/** Client boundary: audit reads run in the browser so they carry the cookie. */
export function AuditClient({ organizationId }: { organizationId: string }) {
  const client = useMemo(() => createCloudApiClient(), []);
  return <Audit client={client} organizationId={organizationId} />;
}
