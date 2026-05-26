// Re-export the drizzle operators consumers use against this schema.
// Importing them through @pinagent/db (rather than directly from
// drizzle-orm in each consumer) guarantees a single drizzle instance
// across the workspace, even when pnpm's peer-deduping creates
// multiple drizzle-orm "identities" at the same version.
export { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, not, or, sql } from 'drizzle-orm';
export * from './schema';
