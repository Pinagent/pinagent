import pinagent from '@pinagent/next-plugin/config';
import type { NextConfig } from 'next';

const coreConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@pinagent/ui'],
};

// pinagent(config, options?) — see packages/next-plugin/src/config.ts.
//
// V2 default: every submit runs a Claude Agent SDK query inline (cwd =
// project root) and streams events back into the widget pane. Pass
// `{ spawnAgent: 'worktree' }` to isolate each run in a fresh git
// worktree on branch `pinagent/<id>`, or `{ spawnAgent: 'off' }` to
// disable per-submit spawning (use channel mode or pull mode instead).
//
// `dock: true` opts the project into the project-management dock surface
// alongside the per-element widget. Sets NEXT_PUBLIC_PINAGENT_DOCK=1 so
// the <Pinagent /> component in app/layout.tsx injects the dock iframe
// automatically — no extra prop needed.
//
// Auth: uses your `claude login` OAuth session by default (billed
// against your subscription). Export ANTHROPIC_API_KEY to bill the API
// account instead.
export default pinagent(coreConfig, { dock: true });
