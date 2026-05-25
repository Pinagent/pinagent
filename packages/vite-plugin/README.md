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
| PATCH  | `/__pinagent/feedback/:id`            | Update `status`, `note`, `commitSha`.              |

Files land in `<project root>/.pinagent/`. Make sure that path is git-ignored.
