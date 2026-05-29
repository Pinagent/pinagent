// SPDX-License-Identifier: Elastic-2.0
import type { ProvisionOptions, SsoProfile, User, UserId, UserStore } from '@pinagent/ee-auth';
import { userFromProfile } from '@pinagent/ee-auth';
import { eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { users } from './schema';

/**
 * Postgres-backed {@link UserStore} — persists the users the SSO callback
 * provisions just-in-time. Written against the Drizzle query builder over
 * {@link schema}, so it works with any pg-dialect driver (Neon in prod,
 * PGlite in tests).
 */

/** Any Drizzle pg database; concrete drivers (neon, pglite) all satisfy this. */
// biome-ignore lint/suspicious/noExplicitAny: accept any driver-specific PgDatabase shape.
export type UserDb = PgDatabase<any, any, any>;

export function createPgUserStore(db: UserDb): UserStore {
  return {
    async get(id: UserId): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },

    async provisionFromProfile(profile: SsoProfile, options?: ProvisionOptions): Promise<User> {
      const now = options?.now ?? new Date().toISOString();
      const [existing] = await db
        .select()
        .from(users)
        .where(eq(users.id, profile.subject))
        .limit(1);
      const user = userFromProfile(profile, existing ?? null, now);
      await db
        .insert(users)
        .values(user)
        .onConflictDoUpdate({
          target: users.id,
          // Keep the original createdAt; refresh the rest.
          set: {
            email: user.email,
            displayName: user.displayName,
            lastLoginAt: user.lastLoginAt,
          },
        });
      return user;
    },
  };
}
