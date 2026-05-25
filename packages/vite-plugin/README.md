# @pinpoint/vite-plugin

Vite plugin (dev-only) that:

1. Tags every JSX opening element with `data-pp-loc="<relPath>:<line>:<col>"` via a Babel transform.
2. Injects a `<script src="/__pinpoint/widget.js">` into served HTML.
3. Serves middleware under `/__pinpoint/*` that writes captured feedback to `.pinpoint/feedback/`.

## Install

```bash
pnpm add -D @pinpoint/vite-plugin
```

## Usage

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pinpoint from '@pinpoint/vite-plugin';

export default defineConfig({
  plugins: [pinpoint(), react()],
});
```

The plugin is `apply: 'serve'` — it does nothing on `vite build`.

## Endpoints

| Method | Path                                  | Purpose                                            |
| ------ | ------------------------------------- | -------------------------------------------------- |
| GET    | `/__pinpoint/widget.js`               | Bundled IIFE (embedded at publish time).           |
| POST   | `/__pinpoint/feedback`                | Receive a comment + screenshot. Returns `{ id }`.  |
| GET    | `/__pinpoint/feedback`                | List all feedback (shallow, no screenshot blob).   |
| GET    | `/__pinpoint/feedback/:id`            | Full record including base64 screenshot.           |
| PATCH  | `/__pinpoint/feedback/:id`            | Update `status`, `note`, `commitSha`.              |

Files land in `<project root>/.pinpoint/`. Make sure that path is git-ignored.
