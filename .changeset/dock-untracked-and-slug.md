---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Dashboard: show new (untracked) files, and name "Start a branch" from the changes.

- `getWorkingCopyStatus` now includes **untracked files** in the file list and
  totals. `git diff` omits them, so a freshly-created file that Create PR would
  commit no longer goes missing from the hero. Counts respect `.gitignore` and
  read line counts without staging.
- **"Start a branch"** now derives a readable slug from a summary of the working
  changes (e.g. `pinagent/add-pricing-tiers`) instead of `pinagent/<id>`, with a
  collision suffix when a name already exists. Falls back to the auto-id when no
  model/key is available.
