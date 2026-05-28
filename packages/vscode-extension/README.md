# @pinagent/vscode-extension

A VSCode extension that hands Pinagent dock conversations back into your editor as a Claude Code terminal.

The Pinagent dock runs in a browser tab (or iframe over your host app). When you want to keep working on a conversation in your real editor — with a terminal, your shell history, and the rest of your VSCode workspace — this extension is the bridge. The dock fires a `vscode://` URI; the extension opens a terminal, runs `claude`, and types the conversation's prompt into it so you can review and submit.

## How the round-trip works

```
┌────────────────────────┐                ┌─────────────────────────┐
│ Pinagent dock          │  vscode://     │ VSCode extension host   │
│ (browser / iframe)     │  pinagent.     │                         │
│                        │  pinagent-     │  URI handler:           │
│ [Terminal icon] ─────▶ │  vscode/       │  - open / reuse terminal│
│ button click           │  open-claude?  │  - sendText('claude')   │
│ in conversation        │  prompt=…      │  - sendText(prompt)     │
│ detail header          │ ──────────────▶│  (no Enter — review)    │
└────────────────────────┘                └─────────────────────────┘
```

The dock encodes the prompt as **base64url(utf8(text))** so newlines, quotes, and shell metacharacters survive the URL trip without escaping. The extension decodes the same way before passing the text into the terminal.

## Install (sideload during preview)

The extension isn't published to the VSCode Marketplace yet. To use it locally:

```bash
# From the repo root
pnpm --filter @pinagent/vscode-extension build
pnpm --filter @pinagent/vscode-extension package
code --install-extension packages/vscode-extension/dist/pinagent-vscode.vsix
```

After install, reload VSCode (Command Palette → "Developer: Reload Window") so the URI handler activates.

## Develop the extension

Open `packages/vscode-extension/` in VSCode and press **F5**. A new "Extension Development Host" window launches with the extension loaded. URIs fire against the dev host instead of your main VSCode, so you can iterate without reinstalling.

`pnpm --filter @pinagent/vscode-extension dev` runs `tsdown --watch` so source edits rebuild `dist/extension.cjs` in place; the dev host picks up the new bundle on the next URI invocation (or after `Developer: Reload Window`).

## URI scheme

```
vscode://pinagent.pinagent-vscode/<action>?<query>
```

Both the publisher (`pinagent`) and the extension name (`pinagent-vscode`) come from the extension's `package.json` manifest. They must match exactly in the URI — different casing or hyphenation will silently route to the wrong extension (or no extension) and nothing will happen.

### Actions

| Action        | Query params                       | Effect                                                                                     |
| ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `open-claude` | `prompt` — base64url-encoded UTF-8 | Open/reuse the "Pinagent → Claude" terminal, run `claude`, and type `prompt` without Enter |

Unknown actions surface a "Pinagent: unknown URI action" warning in VSCode so misrouted URIs are visible during integration work.

## Dock integration

`@pinagent/widget-dock` consumes the URI through a small helper at `packages/widget-dock/src/lib/vscode-bridge.ts`:

```ts
import { openInClaudeCode } from '../lib/vscode-bridge';

// In a button onClick:
openInClaudeCode(detail.comment);
```

Today's only consumer is the Terminal-icon button in the conversation detail header (`packages/widget-dock/src/routes/Conversations.tsx`). The button passes the original comment as the prompt.

The helper fires the URI by clicking a transient anchor element rather than setting `location.href`, so the dock iframe doesn't trip its router on the scheme change before the browser intercepts it.

## Behavior notes

- **Terminal reuse.** A single named terminal ("Pinagent → Claude") is reused across URI invocations. Repeated clicks don't accumulate tabs. If you close the terminal the next URI lazily creates a fresh one.
- **Banner timing.** The extension waits 1500 ms after launching `claude` before typing the prompt — `claude` prints its banner and settles the TTY in that window; sending earlier lands the prompt mid-banner where it gets clobbered. This is a POC value; it can be replaced with a readiness probe if it proves flaky in practice.
- **No auto-submit.** The prompt is typed with `sendText(text, false)` — no trailing newline — so you can review and edit it before pressing Enter. This matches the editorial flow ("I want to confirm before the agent starts") rather than the fire-and-forget flow.
- **Browser protocol prompt.** The first time you fire a `vscode://` URI from a given browser, the browser asks "Open Visual Studio Code?". Once you check "Always allow", subsequent invocations go through silently.

## Limitations & non-goals (today)

- **VSCode-only.** Cursor and other VSCode forks also register the `vscode://` scheme — sideloading the same `.vsix` should work, untested. Other editors (JetBrains, Zed, Neovim) are out of scope; for those, see the "Copy as `claude` command" clipboard fallback discussion in the dock UX thread.
- **No round-trip back to the dock.** The terminal is one-way: the dock fires a prompt, the extension types it. There's no mechanism for the extension to push state back into the dock conversation. If you need that, the MCP runtime is the right surface.
- **Not published to the Marketplace.** Distribution is sideload-only until the bridge has earned its keep.

## Future actions

The URI handler is a switch — new verbs are cheap to add:

- `open-file?path=…&line=…` — jump to a source location (today this works without the extension via plain `vscode://file/<path>:line:col`; an explicit action would let us layer in conversation context)
- `open-claude-with-conversation?id=…` — fetch the full transcript from the dev-server and pipe it into `claude` via a temp file, instead of just the original comment
- `apply-diff?id=…` — pull a worktree diff and stage it for review in VSCode's SCM panel

Each is a few lines in `src/extension.ts` plus a dock-side helper in `widget-dock/src/lib/vscode-bridge.ts`.
