---
'@pinagent/widget-dock': minor
'@pinagent/ui': patch
---

feat(dock): ship the dock in dark mode

The dock now renders dark by default, matching the dark-mode widget. The
`.dark` class is applied on `<html>` across all three entry HTML files (dev
preview, embedded iframe, standalone) so it paints dark on first frame with no
light flash, and Storybook renders stories on the same dark surface.

Because the shell, nav rail, and route screens already use semantic tokens
(`bg-card`, `text-foreground`, `border-border`, …), the existing `.dark` token
set in `@pinagent/ui` drives the whole UI. A few hardcoded light values that
wouldn't follow the theme were fixed: the dev-preview host backdrop gradient
(now `var(--secondary)`), an `ExtensionLaunch` hover (`bg-black/5` →
`bg-foreground/10`), and the worktree-preview iframe fallback (`bg-white` →
`bg-background`). The embedded-mode `color-scheme` is pinned to `dark`.

`@pinagent/ui`: the `.dark` selector now sets `color-scheme: dark` so form
controls, scrollbars, and UA chrome render dark wherever `.dark` is applied.
