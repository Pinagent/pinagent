# @pinagent/vite-plugin

Vite plugin (dev-only) that:

1. Tags every JSX opening element with `data-pa-loc="<relPath>:<line>:<col>"` via a Babel transform.
2. Injects a `<script src="/__pinagent/widget.js">` into served HTML.
3. Serves middleware under `/__pinagent/*` that writes captured feedback to `.pinagent/feedback/`.

## Install

```bash
pnpm add -D @pinagent/vite-plugin
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pinagent from '@pinagent/vite-plugin';

export default defineConfig({
  plugins: [pinagent(), react()],
});
```

The plugin is `apply: 'serve'` — it does nothing on `vite build`.

## Endpoints

| Method | Path                                  | Purpose                                            |
| ------ | ------------------------------------- | -------------------------------------------------- |
| GET    | `/__pinagent/widget.js`               | Bundled IIFE (embedded at publish time).           |
| POST   | `/__pinagent/feedback`                | Receive a comment + screenshot. Returns `{ id }`.  |
| GET    | `/__pinagent/feedback`                | List all feedback (shallow, no screenshot blob).   |
| GET    | `/__pinagent/feedback/:id`            | Full record including base64 screenshot.           |
| GET    | `/__pinagent/feedback/:id/messages`   | Full agent transcript for one conversation.        |
| PATCH  | `/__pinagent/feedback/:id`            | Update `status`, `note`, `commitSha`.              |

Files land in `<project root>/.pinagent/`. Make sure that path is git-ignored.

### Transcript endpoint

`GET /__pinagent/feedback/:id/messages` returns the full persisted
agent transcript for one conversation — every `AgentEvent` that has
been appended to the bus, in insertion order. This is a non-streaming
HTTP read; for live updates, the dock uses a WebSocket subscription
instead. Intended for surfaces where a WebSocket is awkward (CLI,
export tooling, hosted dashboards) and as a cold-load prefetch the
dock fires alongside its WS subscribe so the detail view has content
before the socket connects.

Response shape:

```json
{
  "messages": [
    { "type": "init", "sessionId": "...", "model": "...", "permissionMode": "...", "apiKeySource": "..." },
    { "type": "text", "text": "..." },
    { "type": "tool_use", "name": "Edit", "summary": "src/Foo.tsx" },
    { "type": "tool_result", "ok": true }
  ]
}
```

Event shapes are pinned by `AgentEventSchema` in `@pinagent/shared`.
`init` and `result` events are included (the transcript view wants
them); the internal `__finished` bus sentinel is excluded. Status
codes: `400` on a malformed id, `404` on an unknown conversation,
`200` with `{ "messages": [] }` for a fresh conversation that hasn't
published anything yet.
