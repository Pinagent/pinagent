# MCP server + agent integration

After the runtime-specific install (Vite or Next), every project needs the MCP server registered so the coding agent can read feedback. Same setup whether the upstream is Vite or Next.

## 1. Add to `.gitignore`

```bash
cd /path/to/target/repo
echo ".pinagent" >> .gitignore
# In a monorepo, add it at the monorepo ROOT, not just the app — git's
# .gitignore lookup walks up.
```

Feedback records (a local SQLite DB + PNG screenshots) are user-local and shouldn't be committed. The MCP server (and the Vite/Next route handler) create `.pinagent/db.sqlite` and the `.pinagent/screenshots/` directory lazily on first submit.

## 2. Register the MCP server

> **In a monorepo, register at the repo ROOT — not the individual app.** This is
> the recommended default. Run `claude` from the monorepo root so one
> project-scoped `.mcp.json` (and one agent session) covers the whole workspace:
> the agent can edit the app *and* the shared packages a fix usually touches
> (`packages/ui`, design tokens, etc.), which live outside any single app dir.
> Per-app configs fragment this — N configs to maintain, and each session is
> blind to code outside its app. Point `PINAGENT_PROJECT_ROOT` at the specific
> app whose dev server writes `.pinagent/` (see the worked example below). Only
> drop to a per-app `.mcp.json` if the apps are genuinely independent repos that
> happen to share a folder.

Two scopes:

| Scope | When | Command |
| ----- | ---- | ------- |
| **Project** | Tied to one repo. Recommended — and in a monorepo, run it from the repo ROOT (writes `.mcp.json` there). | `claude mcp add pinagent -s project -- pnpm dlx @pinagent/cli mcp` |
| **User**    | Global — available in any project. | `claude mcp add pinagent -s user -- pnpm dlx @pinagent/cli mcp` |

`@pinagent/cli` is the published entrypoint; `pnpm dlx @pinagent/cli mcp` fetches it and starts the stdio MCP server without a global install. Equivalent lower-level forms: `pnpm dlx @pinagent/mcp` (the server package directly), or `claude mcp add pinagent pinagent-mcp` if `@pinagent/mcp` is already a project dependency.

> **Shortcut:** `pnpm dlx @pinagent/cli init` scaffolds most of this for you — it adds `.pinagent` to `.gitignore`, registers the MCP server in `.mcp.json`, and (on Next) writes the route handler. Run it from the monorepo root so `.mcp.json` lands there. You still wire the plugin into your config and mount `<Pinagent />` by hand.

Registering at the root means the MCP server's project-root resolution (it walks up looking for `.pinagent/` then `package.json`) won't reliably land on the app that runs the dev server. **Pin it explicitly** by editing `.mcp.json`:

```json
{
  "mcpServers": {
    "pinagent": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["dlx", "@pinagent/cli", "mcp"],
      "env": {
        "PINAGENT_PROJECT_ROOT": "/absolute/path/to/apps/your-app"
      }
    }
  }
}
```

`PINAGENT_PROJECT_ROOT` must match where Next/Vite runs from — both processes read/write the same `.pinagent/` directory.

**Worked example — the recommended monorepo layout.** You launch `claude` from the repo root (so it loads one project-scoped config covering every app and shared package) but run `pnpm dev` from `apps/web`. Put `.mcp.json` at the **repo root** and point `PINAGENT_PROJECT_ROOT` at the **app** — the two paths are different on purpose:

```
my-monorepo/
├─ .mcp.json          ← lives here so `claude` (run from root) loads it;
│                        env.PINAGENT_PROJECT_ROOT = "/abs/path/to/my-monorepo/apps/web"
└─ apps/web/
   ├─ .pinagent/      ← created by `pnpm dev`, which runs here
   └─ next.config.ts
```

The rule: `.mcp.json` goes wherever you start `claude`; `PINAGENT_PROJECT_ROOT` goes wherever you start the dev server. They coincide only in a single-package repo.

**More than one UI app? One server per app, each with a distinct key.** The
worked example above wires a *single* app. If you've wired pinagent into several
apps in the same monorepo (a dashboard, a marketing site, a React Native app, …),
each app writes its **own** `.pinagent/db.sqlite`, and one MCP server can only
watch one DB — so register one server **per app**, all in the same root
`.mcp.json`, under distinct keys (`pinagent`, then `pinagent-<app>`):

```json
{
  "mcpServers": {
    "pinagent": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["dlx", "@pinagent/cli", "mcp"],
      "env": { "PINAGENT_PROJECT_ROOT": "/abs/path/to/apps/dashboard" }
    },
    "pinagent-mobile": {
      "type": "stdio",
      "command": "pnpm",
      "args": ["dlx", "@pinagent/cli", "mcp"],
      "env": { "PINAGENT_PROJECT_ROOT": "/abs/path/to/apps/mobile" }
    }
  }
}
```

Claude Code namespaces each server's tools by its key: `mcp__pinagent__*` for the
first, `mcp__pinagent-mobile__*` for the second. That naming carries straight
into the permission allow-list — **every** key must be allow-listed separately
(§4), and channel mode loads the channel for the specific key
(`--dangerously-load-development-channels server:pinagent-mobile`). Skipping a
key in either place breaks that one app silently while the others work.

## 3. Verify the server is reachable

First, a one-shot read-only check of the whole setup (plugin, config, route, gitignore, and this `.mcp.json` + `PINAGENT_PROJECT_ROOT`):

```bash
cd /path/to/target/repo
pnpm dlx @pinagent/cli doctor        # add --dir apps/<app> in a monorepo
```

Then confirm the server is actually connected from the project directory:

```bash
cd /path/to/target/repo
claude mcp list 2>&1 | grep pinagent
# expect:  pinagent: pnpm dlx @pinagent/cli mcp - ✓ Connected
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
      "mcp__pinagent__get_source_context",
      "mcp__pinagent__get_conversation_transcript"
    ]
  }
}
```

(All five `mcp__pinagent__*` tools are listed so nothing is denied mid-flow; `mcp__pinagent__*` as a single wildcard works too — the tool-name segment after a **literal** `mcp__<server>__` prefix accepts globs.)

> **Monorepo with more than one UI app? Allow-list every server.** This is the
> one that bites silently. When the workspace wires several apps, each gets its
> own MCP server under a **distinct key** (`pinagent-www`, `pinagent-mobile`, …
> — see §2 "More than one UI app"). Claude Code namespaces tools by that key, so
> the mobile app's feedback tool is `mcp__pinagent-mobile__get_feedback`, **not**
> `mcp__pinagent__get_feedback`. And **the server segment of a permission rule is
> glob-free** — there is no `mcp__pinagent*` / `mcp__pinagent-*` that spans
> servers (an unanchored glob in the server slot is skipped with a warning and
> approves nothing). So **you must list each server separately**, one
> `mcp__<server>__*` entry per key — the tool-name `*` after the **literal**
> server prefix is allowed, the server name itself must be spelled out in full:
>
> ```json
> {
>   "enableAllProjectMcpServers": true,
>   "permissions": {
>     "allow": [
>       "mcp__pinagent__*",
>       "mcp__pinagent-www__*",
>       "mcp__pinagent-app__*",
>       "mcp__pinagent-support__*",
>       "mcp__pinagent-mobile__*"
>     ]
>   }
> }
> ```
>
> Use the `mcp__<server>__*` glob form (not a bare `mcp__<server>`, which some
> Claude Code versions ignore with a warning). `enableAllProjectMcpServers: true`
> trusts every server in the project `.mcp.json` for your interactive session; if
> you instead pin them with `enabledMcpjsonServers`, list **all** the keys there
> too. Miss one server and that app's feedback silently fails: the agent calls
> its `get_feedback`, the call falls outside the allow-list, and — with no human
> to approve in a spawned or channel run — it's auto-denied ("the … channel needs
> an interactive permission grant that I can't self-approve"). **This applies to
> spawn mode too:** the in-process SDK agent loads these same
> `.claude/settings*.json` rules (it runs with `settingSources: ['user',
> 'project', 'local']`), so the per-server allow-list is exactly what lets a
> spawned run auto-accept its own `get_feedback` / `resolve_feedback`.

> **Agent checkpoint.** If you're an agent running this setup, **stop here** — Claude Code's auto mode blocks you from self-modifying trust settings. Ask the developer to apply the JSON above (or run `/permissions`) and confirm before you continue. In a multi-app monorepo, double-check that **every** `pinagent-*` server key from `.mcp.json` appears in the allow-list — a missing one breaks only that app, which is easy to overlook.

## 5. Pick a feedback-delivery mode

Four options. Match the mode to what kind of feedback flow you want.

> **Default if unspecified.** If you're an agent setting this up and the developer hasn't asked for a specific flow, leave the plugin's default in place (`spawnAgent: 'inline'`) — submitting a comment streams the run straight into the widget, no extra wiring. Only set up channel/worktree/pull mode when the developer asks for it.

### Channel mode (recommended for live, single-session work)

The MCP server polls `.pinagent/db.sqlite` and pushes a `notifications/claude/channel` event into the running Claude Code session each time a new comment lands. The agent reacts immediately in the same session — no spawn cost, no context reset.

Launch:

```bash
cd /path/to/target
claude --dangerously-load-development-channels server:pinagent
```

The `server:pinagent` token must match the key in `.mcp.json`. The `--dangerously-load-development-channels` flag is required during Claude Code's [channels research preview](https://code.claude.com/docs/en/channels) (needs Claude Code **v2.1.80+**) — pinagent isn't on the Anthropic-curated allowlist yet.

Note: only comments left **after** the session starts are pushed as channel events. The watcher ignores the backlog already in the store at boot; reach pre-existing comments with `list_pending_feedback` / `get_feedback`.

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
