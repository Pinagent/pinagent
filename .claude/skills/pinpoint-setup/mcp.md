# MCP server + agent integration

After the runtime-specific install (Vite or Next), every project needs the MCP server registered so the coding agent can read feedback. Same setup whether the upstream is Vite or Next.

## 1. Add to `.gitignore`

```bash
cd /path/to/target/repo
echo ".pinpoint" >> .gitignore
# In a monorepo, add it at the monorepo ROOT, not just the app — git's
# .gitignore lookup walks up.
```

Feedback records (JSON + PNG) are user-local and shouldn't be committed. The MCP server (and the Vite/Next route handler) write the `.pinpoint/feedback/` and `.pinpoint/screenshots/` directories lazily on first submit.

## 2. Register the MCP server

Two scopes:

| Scope | When | Command |
| ----- | ---- | ------- |
| **Project** | Tied to one repo. Recommended for testing. Writes `.mcp.json` in the project root. | `claude mcp add pinpoint -s project -- node /Users/jacksonmalloy/code/pinpoint/packages/mcp/dist/index.js` |
| **User**    | Global — available in any project. | `claude mcp add pinpoint -s user -- node /Users/jacksonmalloy/code/pinpoint/packages/mcp/dist/index.js` |

In a monorepo, the MCP server's project root resolution (walks up looking for `.pinpoint/` then `package.json`) may land at the wrong directory. **Pin it explicitly** by editing `.mcp.json`:

```json
{
  "mcpServers": {
    "pinpoint": {
      "type": "stdio",
      "command": "node",
      "args": ["/Users/jacksonmalloy/code/pinpoint/packages/mcp/dist/index.js"],
      "env": {
        "PINPOINT_PROJECT_ROOT": "/absolute/path/to/apps/your-app"
      }
    }
  }
}
```

`PINPOINT_PROJECT_ROOT` must match where Next/Vite runs from — both processes read/write the same `.pinpoint/` directory.

## 3. Verify the server is reachable

From the project directory:

```bash
cd /path/to/target/repo
claude mcp list 2>&1 | grep pinpoint
# expect:  pinpoint: node /Users/.../@pinpoint/mcp/dist/index.js - ✓ Connected
```

If it isn't connected:

- **Project scope, not connected**: launch `claude` once interactively in the project — Claude Code prompts you to trust the project-scoped `.mcp.json` on first encounter. Approve it.
- **Wrong directory**: project-scoped `.mcp.json` only loads from that project root. If you're in the monorepo root and the config is at `apps/x/.mcp.json`, the server won't be visible. Either `cd apps/x` first or copy `.mcp.json` to the monorepo root (the absolute `PINPOINT_PROJECT_ROOT` keeps storage location correct).

## 4. Pre-approve the MCP tools (auto mode)

Auto mode blocks MCP tool calls by default. After the agent makes an edit, it will say "tools were denied — let me know if you'd like to resolve manually." Fix by adding to project permissions.

Easiest is the `/permissions` slash command inside a running Claude Code session — it manages the file for you. Or write `.claude/settings.local.json` in the project directly:

```json
{
  "enabledMcpjsonServers": ["pinpoint"],
  "enableAllProjectMcpServers": true,
  "permissions": {
    "allow": [
      "mcp__pinpoint__list_pending_feedback",
      "mcp__pinpoint__get_feedback",
      "mcp__pinpoint__resolve_feedback",
      "mcp__pinpoint__get_source_context"
    ]
  }
}
```

The developer must apply this themselves — Claude Code's auto mode blocks self-modification of trust settings without explicit authorization. If you're running as an agent doing this setup, prompt the user to authorize this step.

## 5. Pick a feedback-delivery mode

Four options. Match the mode to what kind of feedback flow you want.

### Channel mode (recommended for live, single-session work)

The MCP server watches `.pinpoint/feedback/` and pushes a `notifications/claude/channel` event into the running Claude Code session each time a new comment lands. The agent reacts immediately in the same session — no spawn cost, no context reset.

Launch:

```bash
cd /path/to/target
claude --dangerously-load-development-channels server:pinpoint
```

The `server:pinpoint` token must match the key in `.mcp.json`. The `--dangerously-load-development-channels` flag is required during Claude Code's [channels research preview](https://code.claude.com/docs/en/channels) — pinpoint isn't on the Anthropic-curated allowlist yet.

If you see `no MCP server configured with that name`, you're launching from the wrong directory. Either `cd` to where `.mcp.json` lives, or pass `--mcp-config /absolute/path/to/.mcp.json` explicitly.

Trade-off: only ONE session at a time. Submits are processed serially in that session.

### Worktree-per-feedback (recommended for parallel / async work) — Next only

Each Submit creates a fresh git worktree at `.pinpoint/worktrees/<id>` on branch `pinpoint/<id>` from current HEAD, then spawns `claude -p` inside it. True parallel agents — they edit different working copies so they can't race.

Opt in via the plugin option in `next.config.js`:

```js
import pinpoint from '@pinpoint/next/config';
export default pinpoint(coreConfig, { spawnAgent: 'worktree' });
```

Each agent's output streams to `.pinpoint/logs/<id>.log` (`tail -f` to watch). After it finishes you review the branch like a PR:

```bash
cd .pinpoint/worktrees/<id>
git diff main
# decide: rebase, cherry-pick, or discard
```

Cleanup when done:

```bash
git worktree remove .pinpoint/worktrees/<id>
git branch -D pinpoint/<id>
```

Trade-offs: each submit is one billed `claude -p` invocation; agents have no prior conversation context; you have N branches to review. Best for explicit review workflows or production-grade async loops.

Requires the consumer repo to be a git repo. `PINPOINT_AGENT_PERMISSION_MODE` controls `--permission-mode` (default `acceptEdits`).

### Inline spawn mode (Next only)

Same as worktree mode but in the main project directory — no worktree. Use this only when you don't have a git repo or don't want branches.

```js
pinpoint(coreConfig, { spawnAgent: 'inline' });
```

⚠️ Parallel agents will edit the same files. If you submit two comments in the same minute, they may race. Channel mode + worktree mode are safer for any real workflow.

### Auto-trigger mode (Vite only)

Vite plugin can spawn `claude -p` per submit, with internal serialization (submits while another agent is running get batched into one followup invocation). Equivalent to "inline" mode but with the race-prevention built in. Worktree mode is not in the Vite plugin yet.

```ts
pinpoint({ autoTrigger: true })
// or with options:
pinpoint({ autoTrigger: { permissionMode: 'bypassPermissions' } })
```

### Pull mode (default everywhere)

Feedback lands on disk. The developer asks their agent "what pinpoint feedback is pending?" — it calls `list_pending_feedback`, then `get_feedback`, then resolves.

No setup beyond steps 1-4. Works without any special launch flags. Combine with any of the above for fallback (the file is always on disk regardless of mode).

### When to pick what

| Need | Use |
| --- | --- |
| Live session, working alongside agent, small edits | Channel mode |
| Async work, review each fix, parallelism | Worktree mode (Next) |
| Hands-off CI-like loop on one repo, Vite stack | Auto-trigger (Vite) |
| Just clicking and bookmarking issues for later | Pull mode |

## Trying the loop

1. Start dev server in one terminal
2. Start Claude Code with channels in another:
   ```bash
   cd /path/to/target && claude --dangerously-load-development-channels server:pinpoint
   ```
3. Open the app in a browser, click 💬, pick element, comment "make this red", submit
4. Watch the Claude Code session — within ~1s you should see a `<channel source="pinpoint" ...>` event arrive, then the agent runs `get_feedback`, edits, calls `resolve_feedback`.

If the agent edits but says "tools were denied", revisit step 4 (permissions allowlist).

## Cleanup

To remove pinpoint from a project:

```bash
cd /path/to/target
pnpm remove @pinpoint/vite-plugin    # or @pinpoint/next
rm .mcp.json                          # if project-scoped
rm -rf .pinpoint                      # local feedback
# revert vite.config.ts / next.config.js / app/layout.tsx / app/pinpoint/ as needed
```

Or for a user-scoped MCP registration:

```bash
claude mcp remove pinpoint -s user
```
