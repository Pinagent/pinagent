// SPDX-License-Identifier: Apache-2.0
// Production stub for `@pinagent/next-plugin/route`.
//
// Resolved by the `"default"` condition in package.json exports when the
// bundler is not running in `"development"`. Keeps the dev route's heavy
// transitive dependencies (`@anthropic-ai/claude-agent-sdk`, `@babel/*`,
// `ws`, node:child_process, node:fs) out of production function bundles.
//
// Consumers still mount `app/pinagent/[[...slug]]/route.ts` with the
// inline `dynamic` / `runtime` route-segment config required by Next 16.
// In prod the handler responds 404 so the path is inert.

const notFound = (): Response =>
  new Response(null, {
    status: 404,
    headers: { 'cache-control': 'no-store' },
  });

export const GET = notFound;
export const POST = notFound;
export const PATCH = notFound;
export const PUT = notFound;
export const DELETE = notFound;
