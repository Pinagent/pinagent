---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
---

Let the running-agents tray be minimized back to the pin. The tray gains a
minimize button; when collapsed while agents are still live, the FAB pin shows
a count badge plus a pulse ring (while any agent is working) so live runs stay
glanceable, and a click re-expands the tray. The expanded default is unchanged —
a newly-appeared agent (or the list emptying) auto-expands again, so a fresh run
is never hidden behind a minimized pin.
