---
"@pinagent/widget-dock": patch
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Keep the dock dashboard's working-changes hero fresh when files change on disk.

The dev-server now watches the host project tree (chokidar) and fans out a
`working_copy_changed` event whenever a source file is added/changed/removed —
so editing or reverting in your editor refreshes the dashboard's git status
immediately, instead of waiting for a window-focus refetch or a pinagent
lifecycle event. The watcher ignores `.git`, `.pinagent`, and dependency/build
dirs, and debounces bursts (e.g. a multi-file `git checkout`) into a single
refresh.
