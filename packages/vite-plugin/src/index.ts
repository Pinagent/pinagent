// SPDX-License-Identifier: Apache-2.0
import { relative, sep } from 'node:path';
import { isInGitignore, Storage } from '@pinagent/agent-runner';
import { transformJsx } from '@pinagent/babel-plugin';
import type { Plugin } from 'vite';
import { AutoTrigger, type AutoTriggerOptions } from './auto-trigger';
import { createMiddleware } from './middleware';

export interface PinagentOptions {
  /**
   * Override the project root. Defaults to Vite's `server.config.root`.
   */
  root?: string;
  /**
   * When a comment is submitted, automatically spawn a CLI agent to address it.
   * Pass `true` to use defaults (claude -p with --permission-mode acceptEdits),
   * or an options object to customize.
   *
   * Requires the agent's CLI to be on PATH (e.g. `claude` from Claude Code).
   * Submits are serialized — if multiple feedback items arrive while an agent
   * is running, they're batched into the next invocation.
   */
  autoTrigger?: boolean | AutoTriggerOptions;
}

const SCRIPT_TAG = '<script type="module" src="/__pinagent/widget.js"></script>';

export default function pinagent(options: PinagentOptions = {}): Plugin {
  let isServe = false;
  let resolvedRoot = process.cwd();

  return {
    name: 'pinagent',
    apply: 'serve',
    enforce: 'pre',

    config() {
      // Mark that we're serving — Vite calls `apply: 'serve'` for us, but
      // duplicating here for clarity.
      isServe = true;
    },

    configResolved(cfg) {
      resolvedRoot = options.root ?? cfg.root;
    },

    async configureServer(server) {
      const root = options.root ?? server.config.root;
      resolvedRoot = root;
      const storage = new Storage(root);

      const inGi = await isInGitignore(root);
      if (!inGi) {
        server.config.logger.warn(
          '[pinagent] .pinagent/ is not in .gitignore — feedback files and screenshots may be committed.',
        );
      }

      let autoTrigger: AutoTrigger | null = null;
      if (options.autoTrigger) {
        const triggerOpts: AutoTriggerOptions =
          typeof options.autoTrigger === 'object' ? options.autoTrigger : {};
        autoTrigger = new AutoTrigger(triggerOpts, root, server.config.logger);
        server.config.logger.info(
          `[pinagent] auto-trigger ON — Claude Agent SDK (${triggerOpts.permissionMode ?? 'acceptEdits'}) will run on each submit`,
        );
      }

      server.middlewares.use(createMiddleware(storage, autoTrigger));

      server.config.logger.info('[pinagent] ready — widget at /__pinagent/widget.js');
    },

    transform(code, id) {
      if (!isServe) return null;
      // Strip query strings (Vite adds e.g. ?v=hash, ?t=ts).
      const cleanId = id.split('?')[0] ?? id;
      if (!/\.(t|j)sx$/.test(cleanId)) return null;
      // Skip node_modules.
      if (cleanId.includes(`${sep}node_modules${sep}`) || cleanId.includes('/node_modules/')) {
        return null;
      }

      const rel = toPosix(relative(resolvedRoot, cleanId)) || cleanId;
      const ts = /\.tsx$/.test(cleanId);
      const transformed = transformJsx(code, { relPath: rel, ts });
      if (!transformed) return null;
      // Return as a string with `map: null` so Vite generates a fresh map from
      // the diff. This is acceptable because we only insert whitespace +
      // attributes inline; original line numbers are preserved.
      return { code: transformed, map: null };
    },

    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!isServe) return html;
        if (html.includes('/__pinagent/widget.js')) return html;
        if (html.includes('</body>')) {
          return html.replace('</body>', `${SCRIPT_TAG}\n</body>`);
        }
        return `${html}\n${SCRIPT_TAG}`;
      },
    },
  };
}

function toPosix(p: string): string {
  return p.split(sep).join('/');
}
