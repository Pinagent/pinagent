import type { NextConfig } from 'next';
import pinpoint from '@pinpoint/next/config';

const coreConfig: NextConfig = {
  reactStrictMode: true,
};

// pinpoint(config, options?) — see packages/next/src/config.ts.
//
// V2 default: every submit runs a Claude Agent SDK query inline (cwd =
// project root) and streams events back into the widget pane. Pass
// `{ spawnAgent: 'worktree' }` to isolate each run in a fresh git
// worktree on branch `pinpoint/<id>`, or `{ spawnAgent: 'off' }` to
// disable per-submit spawning (use channel mode or pull mode instead).
//
// Auth: uses your `claude login` OAuth session by default (billed
// against your subscription). Export ANTHROPIC_API_KEY to bill the API
// account instead.
export default pinpoint(coreConfig);
