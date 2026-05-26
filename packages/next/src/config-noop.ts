// SPDX-License-Identifier: Apache-2.0
// Production stub for `@pinagent/next/config`.
//
// Resolved by the `"default"` condition in package.json exports when the
// bundler is not running in the `"development"` condition (i.e. production
// builds). Keeps pinagent completely out of prod bundles — no webpack
// wrapper, no rewrites wrapper, no turbopack rule. Returns the user's
// config unchanged.
//
// This is the belt; src/config.ts has the suspenders (also no-ops in prod
// when NODE_ENV === 'production'). Either path alone is sufficient.

// biome-ignore lint/suspicious/noExplicitAny: NextConfig isn't easily importable as a type-only dep
type NextConfig = any;

export default function pinagent(config: NextConfig = {}): NextConfig {
  return config;
}
