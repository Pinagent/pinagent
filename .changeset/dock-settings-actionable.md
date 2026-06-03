---
"@pinagent/widget-dock": minor
---

Settings tab: live refresh + clear which permission mode is actually in force.

The Settings form now refetches while visible (paused when the dock is
hidden), so an external `config.json` edit — or, more usefully, an env-override
change after a dev-server restart — surfaces without a manual refetch. When
`PINAGENT_AGENT_PERMISSION_MODE` is set, the permission-mode picker now marks
the row that's actually **In force** and labels your persisted selection
**Saved** (it applies once the env is unset), instead of misleadingly badging
the saved row as "current."
