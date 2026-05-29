---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Harden the bring-your-own-model CLI agent provider against edge cases.

Four robustness fixes to the new `cli` provider (wraps an arbitrary
agentic CLI and translates its output into Pinagent events):

- **Signal-terminated runs are no longer reported as success.** A child
  killed by a signal (SIGKILL on OOM, SIGSEGV on a crash) exits with a
  null code; `code ?? 0` previously made that look like a clean exit 0.
  The result now inspects the terminating signal and reports an error.
- **A child that exits before reading stdin no longer crashes the dev
  server.** Writing the prompt into a closed/again-destroyed stdin pipe
  emitted an unhandled `EPIPE` error; stdin now has an error handler and
  the write is guarded.
- **Spawn failures surface the real cause.** A missing or non-executable
  command (ENOENT/EACCES) now reports `failed to start <cmd>: <reason>`
  instead of a misleading "exited with code 1".
- **stderr stays diagnostics.** stderr lines are always rendered as
  tagged text (even in `stream-json` mode, where a non-JSON diagnostic
  would otherwise masquerade as untagged model output) and never inflate
  the turn/progress counter, which tracks assistant turns.
