# @pinagent/web

The Pinagent marketing site.

```bash
pnpm --filter @pinagent/web dev      # http://localhost:3030
pnpm --filter @pinagent/web build
pnpm --filter @pinagent/web start
```

Stack: Next.js 16 App Router, React 19, Tailwind 4. Shared design tokens come
from `@pinagent/ui` (the same theme the dock and example apps use).

This app is intentionally minimal — one static page (`app/page.tsx`) and one
client component for the install tabs (`app/_components/InstallTabs.tsx`).
