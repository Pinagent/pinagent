---
"@pinagent/widget-dock": patch
---

Keep the dock dashboard's working-changes hero fresh with visibility-scoped polling.

The hero reads live git state but, on its own, only refetched on pinagent
lifecycle events, the Create-PR / Push actions, or a window-focus refetch
(gated by a 60s staleTime) — so editing or reverting files directly in your
editor left it stale until one of those fired. `useWorkingCopy` now sets a
short `refetchInterval` (5s), which TanStack Query pauses automatically when
the dashboard isn't mounted or the tab is backgrounded.

Chosen over a server-side filesystem watcher: a watcher gives instant,
focus-independent updates but holds OS watch handles on the whole tree for the
entire dev session (and would add a dependency). Polling does a little
redundant `git diff` work only while the dashboard is visible, costs nothing
otherwise, and needs no extra dep — the better fit for a lightweight localhost
tool. Worst-case staleness is ~5s while viewing.
