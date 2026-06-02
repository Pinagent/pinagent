// SPDX-License-Identifier: Elastic-2.0
import type { ProvisionOptions, SsoProfile, User, UserId, UserStore } from '@pinagent/ee-auth';
import { defaultUserId, userFromProfile } from '@pinagent/ee-auth';
import { and, eq, sql } from 'drizzle-orm';
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

  /**
   * Resolve an existing IdP identity `(connectionId, subject)` to its user and
   * refresh the record. Returns null when the identity isn't mapped yet (a
   * first login). Self-heals a missing user row (identity present, user absent
   * — e.g. a crash between the two first-login inserts) by re-provisioning it.
   */
  async function resolveExisting(profile: SsoProfile, now: string): Promise<User | null> {
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
    if (!identity) return null;
    const [existing] = await db.select().from(users).where(eq(users.id, identity.userId)).limit(1);
    const user = userFromProfile(identity.userId, profile, existing ?? null, now);
    await upsertUser(user);
    return user;
  }

  return {
    async get(id: UserId): Promise<User | null> {
      const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      return row ?? null;
    },

    async findByEmail(email: string): Promise<User[]> {
      // Case-insensitive: `users.email` stores the raw IdP email.
      return db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
    },

    async provisionFromProfile(profile: SsoProfile, opts?: ProvisionOptions): Promise<User> {
      const now = opts?.now ?? new Date().toISOString();

      // Returning user: refresh and return.
      const existing = await resolveExisting(profile, now);
      if (existing) return existing;

      // First login. Atomically claim the identity → userId mapping: the
      // `onConflictDoNothing` insert IS the race gate. Two concurrent first
      // logins for the same (connectionId, subject) both see no identity above,
      // but only one wins this insert. (No FK from sso_identities.user_id, so
      // we can claim the identity before writing the user row.) Previously this
      // was a SELECT-then-INSERT with no conflict handling, so the loser's
      // transaction threw a duplicate-key error that surfaced as a failed login.
      const user = userFromProfile(generateId(), profile, null, now);
      const [claimed] = await db
        .insert(ssoIdentities)
        .values({
          connectionId: profile.connectionId,
          subject: profile.subject,
          userId: user.id,
        })
        .onConflictDoNothing()
        .returning();

      if (!claimed) {
        // Lost the race: the winner already mapped this identity. Resolve and
        // return their user instead of minting a duplicate.
        const winner = await resolveExisting(profile, now);
        if (winner) return winner;
        // Identity present for the conflict but gone on re-resolve — only a
        // racing deletion (none exists in this system) gets here; fall through
        // so login still succeeds with the user we minted.
      }

      await upsertUser(user);
      return user;
    },
  };
}
