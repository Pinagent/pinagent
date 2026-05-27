# MCP server + agent integration

After the runtime-specific install (Vite or Next), every project needs the MCP server registered so the coding agent can read feedback. Same setup whether the upstream is Vite or Next.

## 1. Add to `.gitignore`

```bash
cd /path/to/target/repo
echo ".pinagent" >> .gitignore
# In a monorepo, add it at the monorepo ROOT, not just the app — git's
# .gitignore lookup walks up.
```

Feedback records (JSON + PNG) are user-local and shouldn't be committed. The MCP server (and the Vite/Next route handler) write the `.pinagent/feedback/` and `.pinagent/screenshots/` directories lazily on first submit.

## 2. Register the MCP server

Two scopes:

| Scope | When | Command |
| ----- | ---- | ------- |
| **Project** | Tied to one repo. Recommended for testing. Writes `.mcp.json` in the project root. | `claude mcp add pinagent -s project -- node /Users/jacksonmalloy/code/pinagent/packages/mcp/dist/index.js` |
| **User**    | Global — available in any project. | `claude mcp add pinagent -s user -- node /Users/jacksonmalloy/code/pinagent/packages/mcp/dist/index.js` |

In a monorepo, the MCP server's project root resolution (walks up looking for `.pinagent/` then `package.json`) may land at the wrong directory. **Pin it explicitly** by editing `.mcp.json`:

```json
{
  "mcpServers": {
    "pinagent": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/jacksonmalloy/code/pinagent/packages/mcp/dist/index.js"],
      "env": {
        "PINAGENT_PROJECT_ROOT": "/absolute/path/to/apps/your-app"
      }
    }
  }
}
```

`PINAGENT_PROJECT_ROOT` must match where Next/Vite runs from — both processes read/write the same `.pinagent/` directory.

## 3. Verify the server is reachable

From the project directory:

```bash
cd /path/to/target/repo
claude mcp list 2>&1 | grep pinagent
# expect:  pinagent: node /Users/.../@pinagent/mcp/dist/index.js - ✓ Connected
```

If it isn't connected:

- **Project scope, not connected**: launch `claude` once interactively in the project — Claude Code prompts you to trust the project-scoped `.mcp.json` on first encounter. Approve it.
- **Wrong directory**: project-scoped `.mcp.json` only loads from that project root. If you're in the monorepo root and the config is at `apps/x/.mcp.json`, the server won't be visible. Either `cd apps/x` first or copy `.mcp.json` to the monorepo root (the absolute `PINAGENT_PROJECT_ROOT` keeps storage location correct).

## 4. Pre-approve the MCP tools (auto mode)

Auto mode blocks MCP tool calls by default. After the agent makes an edit, it will say "tools were denied — let me know if you'd like to resolve manually." Fix by adding to project permissions.

Easiest is the `/permissions` slash command inside a running Claude Code session — it manages the file for you. Or write `.claude/settings.local.json` in the project directly:

```json
{
  "enabledMcpjsonServers": ["pinagent"],
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": [
      "mcp__pinagent__list_pending_feedback",
      "mcp__pinagent__get_feedback",
      "mcp__pinagent__resolve_feedback",
      "mcp__pinagent__get_source_context"
    ]
  }
}
```

The developer must apply this themselves — Claude Code's auto mode blocks self-modification of trust settings without explicit authorization. If you're running as an agent doing this setup, prompt the user to authorize this step.

## 5. Pick a feedback-delivery mode

Four options. Match the mode to what kind of feedback flow you want.

### Channel mode (recommended for live, single-session work)

The MCP server watches `.pinagent/feedback/` and pushes a `notifications/claude/channel` event into the running Claude Code session each time a new comment lands. The agent reacts immediately in the same session — no spawn cost, no context reset.

Launch:

```bash
cd /path/to/target
claude --dangerously-load-development-channels server:pinagent
```

The `server:pinagent` token must match the key in `.mcp.json`. The `--dangerously-load-development-channels` flag is required during Claude Code's [channels research preview](https://code.claude.com/docs/en/channels) — pinagent isn't on the Anthropic-curated allowlist yet.

If you see `no MCP server configured with that name`, you're launching from the wrong directory. Either `cd` to where `.mcp.json` lives, or pass `--mcp-config /absolute/path/to/.mcp.json` explicitly.

Trade-off: only ONE session at a time. Submits are processed serially in that session.

### Worktree-per-feedback (recommended for parallel / async work) — Next only

Each Submit creates a fresh git worktree at `.pinagent/worktrees/<id>` on branch `pinagent/<id>` from current HEAD, then runs a Claude Agent SDK `query()` with `cwd` set to the worktree. True parallel agents — they edit different working copies so they can't race.

The first turn's `sessionId` is persisted on the feedback record (`agent.sessionId`) so future turns can resume the same conversation rather than restarting from scratch. This is what the v2 chat-surface UI will use; for now you can resume manually if needed.

Opt in via the plugin option in `next.config.js`:

```js
import pinagent from '@pinagent/next-plugin/config';
export default pinagent(coreConfig, { spawnAgent: 'worktree' });
```

Each agent's output streams to `.pinagent/logs/<id>.md` as a structured markdown transcript — text deltas inline, tool calls as collapsed chips with file paths, a usage/cost footer per turn (`tail -f` to watch). After it finishes you review the branch like a PR:

```bash
cd .pinagent/worktrees/<id>
git diff main
# decide: rebase, cherry-pick, or discard
```

Cleanup when done:

```bash
git worktree remove .pinagent/worktrees/<id>
git branch -D pinagent/<id>
```

Trade-offs: each submit is one billed Agent SDK run; first turn starts cold (no prior context); you have N branches to review. Best for explicit review workflows or production-grade async loops.

Requires:
- The consumer repo is a git repo.
- Either `claude login` (uses the OAuth subscription, default — billed against the developer's Claude account), an exported `ANTHROPIC_API_KEY` (bills the API account), or a `CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY` provider env var. The SDK bundles the Claude Code binary and respects the same auth as the CLI.

`PINAGENT_AGENT_PERMISSION_MODE` is passed as the SDK's `permissionMode` (default `acceptEdits`).

### Inline spawn mode (Next only)

Same as worktree mode (Agent SDK in-process) but `cwd` is the main project directory — no worktree. Use this only when you don't have a git repo or don't want branches.

```js
pinagent(coreConfig, { spawnAgent: 'inline' });
```

⚠️ Parallel agents will edit the same files. If you submit two comments in the same minute, they may race. Channel mode + worktree mode are safer for any real workflow.

### Inline / worktree spawn mode (Vite)

Vite plugin shares `@pinagent/agent-runner` with the Next plugin and exposes the same `spawnAgent: 'inline' | 'worktree' | 'off' | false` option (default `'inline'`). Streaming output, follow-up turns, and `ask_user` prompts all render in the widget over WebSocket — identical UX to Next.

Same auth options as the Next spawn modes: `claude login` (subscription, default), `ANTHROPIC_API_KEY` (API account), or a `CLAUDE_CODE_USE_*` provider env var.

```ts
pinagent()                            // default: spawnAgent: 'inline'
pinagent({ spawnAgent: 'worktree' })  // parallel isolated git worktrees
pinagent({ spawnAgent: 'off' })       // disable per-submit spawn entirely
```

### Pull mode

Feedback lands on disk. The developer asks their agent "what pinagent feedback is pending?" — it calls `list_pending_feedback`, then `get_feedback`, then resolves.

No setup beyond steps 1-4. Use this when you want comments to bookmark issues for later rather than triggering a per-submit agent. Combine with `spawnAgent: 'off'` in your `next.config.ts` so submits don't ALSO kick off an inline agent.

### When to pick what

| Need | Use |
| --- | --- |
| **Default Next setup — submit, watch streaming output in the widget** | Inline spawn (V2 default — `spawnAgent: 'inline'` or just leave unset) |
| Async work, review each fix, parallelism | Worktree spawn (`spawnAgent: 'worktree'`) |
| Live session, working alongside agent in your existing terminal | Channel mode + `spawnAgent: 'off'` so submits don't double up |
| Hands-off CI-like loop on one repo, Vite stack | Auto-trigger (Vite) |
| Just clicking and bookmarking issues for later | Pull mode + `spawnAgent: 'off'` |

## Trying the loop

1. Start dev server in one terminal
2. Start Claude Code with channels in another:
   ```bash
   cd /path/to/target && claude --dangerously-load-development-channels server:pinagent
   ```
3. Open the app in a browser, click 💬, pick element, comment "make this red", submit
4. Watch the Claude Code session — within ~1s you should see a `<channel source="pinagent" ...>` event arrive, then the agent runs `get_feedback`, edits, calls `resolve_feedback`.

If the agent edits but says "tools were denied", revisit step 4 (permissions allowlist).

## Cleanup

To remove pinagent from a project:

```bash
cd /path/to/target
pnpm remove @pinagent/vite-plugin    # or @pinagent/next-plugin
rm .mcp.json                          # if project-scoped
rm -rf .pinagent                      # local feedback
# revert vite.config.ts / next.config.js / app/layout.tsx / app/pinagent/ as needed
```

Or for a user-scoped MCP registration:

```bash
claude mcp remove pinagent -s user
```
