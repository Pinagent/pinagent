// SPDX-License-Identifier: Elastic-2.0
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Two levels up from apps/cloud-dashboard reaches the monorepo root. Setting
// `turbopack.root` + `outputFileTracingRoot` explicitly silences the
// "multiple lockfiles detected" warning under sibling worktrees and anchors
// dependency tracing so workspace packages bundle correctly. (Same rationale
// as apps/web.)
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// The control-plane Worker (apps/cloud). Defaults to the local `wrangler dev`
// origin; set CLOUD_API_ORIGIN to the deployed control plane in production.
const apiOrigin = process.env.CLOUD_API_ORIGIN ?? 'http://127.0.0.1:8787';

// API surfaces the dashboard reads. Proxied same-origin so the browser sends
// the session cookie without a cross-site request.
const API_PREFIXES = [
  'usage',
  'members',
  'audit',
  'subscriptions',
  'cost-controls',
  'branch-routing',
  'sso',
];

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pinagent/ui'],
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
  async rewrites() {
    return API_PREFIXES.map((prefix) => ({
      source: `/${prefix}/:path*`,
      destination: `${apiOrigin}/${prefix}/:path*`,
    })).concat(
      API_PREFIXES.map((prefix) => ({
        source: `/${prefix}`,
        destination: `${apiOrigin}/${prefix}`,
      })),
    );
  },
};

export default config;
