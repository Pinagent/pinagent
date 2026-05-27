import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// Two levels up from apps/web reaches the monorepo root. Setting both
// `turbopack.root` and `outputFileTracingRoot` explicitly: silences the
// "multiple lockfiles detected" warning that surfaces when this repo is
// checked out under a sibling worktree, and tells Next where to anchor
// dependency tracing so workspace packages like @pinagent/ui get
// bundled correctly when this deploys from a subdirectory on Vercel.
const monorepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const config: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pinagent/ui'],
  turbopack: { root: monorepoRoot },
  outputFileTracingRoot: monorepoRoot,
};

export default config;
