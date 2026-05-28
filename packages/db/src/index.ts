// SPDX-License-Identifier: Apache-2.0
// Re-export the drizzle operators consumers use against this schema.
// Importing them through @pinagent/db (rather than directly from
// drizzle-orm in each consumer) guarantees a single drizzle instance
// across the workspace, even when pnpm's peer-deduping creates
// multiple drizzle-orm "identities" at the same version.
export {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  inArray,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
export * from './schema';
