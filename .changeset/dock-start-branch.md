---
"@pinagent/widget-dock": minor
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Add a "Start a branch" action to the dashboard when you're on the base branch.

Previously the primary button was disabled (`Create PR · On main`) when the
dev server was on the base branch, since you can't open a PR from main onto
main. It now offers **Start a branch**: it creates a fresh feature branch and
switches to it, carrying your uncommitted working changes over (leaving the
base branch clean, via `git switch -c`). The hero then re-derives onto the new
branch and the button flips to **Create PR**. The auto-generated
`pinagent/<id>` name is fine — the eventual Create PR supplies the real,
agent-summarized title. Backed by `POST /__pinagent/working-copy/branch` in
both plugins.
