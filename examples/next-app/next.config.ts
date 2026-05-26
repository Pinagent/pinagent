import pinagent from '@pinagent/next/config';
import type { NextConfig } from 'next';

const coreConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pinagent/ui'],
};

// pinagent(config, options?) — see packages/next/src/config.ts.
//
// V2 default: every submit runs a Claude Agent SDK query inline (cwd =
// project root) and streams events back into the widget pane. Pass
// `{ spawnAgent: 'worktree' }` to isolate each run in a fresh git
// worktree on branch `pinagent/<id>`, or `{ spawnAgent: 'off' }` to
// disable per-submit spawning (use channel mode or pull mode instead).
//
// Auth: uses your `claude login` OAuth session by default (billed
// against your subscription). Export ANTHROPIC_API_KEY to bill the API
// account instead.
export default pinagent(coreConfig);
