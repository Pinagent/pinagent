# @pinagent/ui

## 0.1.0

### Minor Changes

- 53379b0: feat(widget): dark-mode redesign matching the dock

  The in-page widget now renders in dark mode, matching the dock's dark theme —
  deep ink surfaces (`#201B21` / `#2A2528`), cream text, gold accent. The
  composer card, header pills, breadcrumb, quick-action chips, textarea, stream
  log, @-mention menu, follow-up bar, minimized bubbles, drag handle, tray,
  hint, and toast were all reskinned; primary buttons invert to cream-on-ink for
  a strong CTA on dark. The shadow root and composer iframe now opt into
  `color-scheme: dark`.

  A dark-tuned status palette (`STATUS_DARK`) was added to `@pinagent/ui/tokens`
  (mirroring the `.dark` status block in `globals.css`) so the widget's status
  dots, bubbles, and lifecycle chips read on the dark surfaces without drifting
  from the dock.

### Patch Changes

- e92e7fc: feat(dock): ship the dock in dark mode

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
