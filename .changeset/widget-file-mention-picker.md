---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

feat(widget): `@`-mention file picker in the composer

Type `@` in the composer (the initial "describe the change" box and the
follow-up reply box) to get an autocomplete of project files — the browser
analogue of Claude Code's own `@`. Picking a file inserts its path into the
prompt so the agent gets an exact `file` reference; picking a directory keeps
the menu open to drill in. A query starting with `/` or `~` browses the real
filesystem instead of project files (the "reach anywhere" mode), which is safe
because the dev server is localhost-only.

Backed by a new `GET /__pinagent/files` endpoint (in both plugins) over a
shared `listProjectFiles` helper: `git ls-files` for project mode (respects
`.gitignore`, with an `fs`-walk fallback for non-git projects) and a directory
listing for path mode. The same picker is also wired into the dock's
conversation reply box.
