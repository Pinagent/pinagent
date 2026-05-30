// SPDX-License-Identifier: Elastic-2.0
import type { ProvisionOptions, SsoProfile, User, UserId, UserStore } from '@pinagent/ee-auth';
import { defaultUserId, userFromProfile } from '@pinagent/ee-auth';
import { and, eq } from 'drizzle-orm';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { ssoIdentities, users } from './schema';

/**
 * Postgres-backed {@link UserStore} — persists the users the SSO callback
 * provisions just-in-time. The internal user id is synthetic; the IdP identity
 * `(connectionId, subject)` is resolved to it via the `sso_identities` table.
 * Written against the Drizzle query builder over {@link schema}, so it works
 * with any pg-dialect driver (Neon in prod, PGlite in tests).
 */

/** Any Drizzle pg database; concrete drivers (neon, pglite) all satisfy this. */
// biome-ignore lint/suspicious/noExplicitAny: accept any driver-specific PgDatabase shape.
export type UserDb = PgDatabase<any, any, any>;

export interface PgUserStoreOptions {
  /** Synthetic-id generator; injected so tests can assert deterministic ids. */
  generateId?: () => UserId;
}

export function createPgUserStore(db: UserDb, options: PgUserStoreOptions = {}): UserStore {
  const generateId = options.generateId ?? defaultUserId;

  /** Insert-or-refresh a user row, preserving createdAt on conflict. */
  async function upsertUser(user: User): Promise<void> {
    await db
      .insert(users)
      .values(user)
      .onConflictDoUpdate({
        target: users.id,
        // Keep the original createdAt; refresh the rest.
        set: { email: user.email, displayName: user.displayName, lastLoginAt: user.lastLoginAt },
      });
  }

  return {
    async get(id: UserId): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },

    async provisionFromProfile(profile: SsoProfile, opts?: ProvisionOptions): Promise<User> {
      const now = opts?.now ?? new Date().toISOString();

      // Resolve the internal user id from the IdP identity.
      const [identity] = await db
        .select()
        .from(ssoIdentities)
        .where(
          and(
            eq(ssoIdentities.connectionId, profile.connectionId),
            eq(ssoIdentities.subject, profile.subject),
          ),
        )
        .limit(1);

      if (identity) {
        // Returning user: refresh the existing record, keep its id + createdAt.
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.id, identity.userId))
          .limit(1);
        const user = userFromProfile(identity.userId, profile, existing ?? null, now);
        await upsertUser(user);
        return user;
      }

      // First login for this identity: mint a synthetic id, then insert the
      // user + the identity mapping atomically.
      const user = userFromProfile(generateId(), profile, null, now);
      await db.transaction(async (tx) => {
        await tx.insert(users).values(user);
        await tx.insert(ssoIdentities).values({
          connectionId: profile.connectionId,
          subject: profile.subject,
          userId: user.id,
        });
      });
      return user;
    },
  };
}
