---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/widget-dock": patch
---

Surface running inline-mode agents in the widget's running-agents tray. The FAB
tray previously only morphed open for `worktree`-mode runs (which persist as
`worktreeState: 'active'`); a default `inline`-mode agent runs as
`(status: 'pending', worktreeState: 'none')`, which derives to the terminal
`pending` and never appeared. The `GET /__pinagent/feedback` projection now
carries an `isRunning` flag (true while an `active_runs` row exists), and
`deriveDockStatus` folds it in as a top-precedence `working` state, so a live
inline run shows in the tray (and the dock status badge) and clears the moment
the turn ends. The agent runtime also emits `conversations_changed` on run
start/finish so the tray re-fetches without waiting on the project poller.
