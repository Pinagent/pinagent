// SPDX-License-Identifier: Elastic-2.0
import type { MembershipDb } from './membership-store';

/**
 * Build one Neon-serverless Drizzle client, shared by every Postgres adapter
 * (membership + audit) so a deployment opens a single connection pool. Works
 * in both Workers and Node.
 */
export async function createNeonDb(connectionString: string): Promise<MembershipDb> {
  const { Pool } = await import('@neondatabase/serverless');
  const { drizzle } = await import('drizzle-orm/neon-serverless');
  return drizzle(new Pool({ connectionString }));
}
