# @pinagent/ui

Shared shadcn/ui components and Tailwind v4 theme for Pinagent Next.js apps.

## What's inside

- **Theme**: cream-on-dark palette baked into CSS variables (`src/styles/globals.css`).
  - Light: background `#FCF9E8`, foreground `#201B21`.
  - Dark: inverse, accessed via `.dark` class on `<html>`.
- **Components**: `Button`, `Card` (+ subcomponents) under `src/components/ui/`.
- **Utils**: `cn()` for class merging (`src/lib/utils.ts`).

## Consuming from a Next.js app

1. Add the workspace dep:

   ```jsonc
   // examples/<app>/package.json
   "dependencies": {
     "@pinagent/ui": "workspace:*",
     "tailwindcss": "^4",
     "@tailwindcss/postcss": "^4"
   }
   ```

2. Tell Next to transpile the package:

   ```ts
   // next.config.ts
   transpilePackages: ["@pinagent/ui"],
   ```

3. PostCSS config:

   ```js
   // postcss.config.mjs
   export default { plugins: { "@tailwindcss/postcss": {} } };
   ```

4. Import the shared CSS once (typically in `app/layout.tsx`):

   ```ts
   import "@pinagent/ui/styles/globals.css";
   ```

   The CSS uses Tailwind v4's `@source` to scan this package's `src/` so utility classes used in components are emitted. If you author Tailwind classes in your app, Tailwind v4 auto-scans the app's own files.

5. Use components:

   ```tsx
   import { Button } from "@pinagent/ui/components/ui/button";
   import { Card, CardHeader, CardTitle } from "@pinagent/ui/components/ui/card";
   ```

## Adding more shadcn components

`components.json` is configured for this package. From inside `packages/ui/`:

```bash
pnpm dlx shadcn@latest add dialog tabs input
```

Components land in `src/components/ui/`. Add a matching export entry to
`package.json` so consumers can import them by subpath.
