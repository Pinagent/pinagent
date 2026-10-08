---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/widget-dock": patch
"@pinagent/react-native": patch
---

Ask the developer before a tool call the agent isn't pre-approved for, instead of silently denying it. The inline agent used to run headless with no permission handler, so a read outside the project, an un-allowlisted Bash command or MCP tool was denied without a word — the run looked stalled behind a row of "✗ tool result" lines. Those calls now raise an Allow / Allow for this run / Deny prompt in the widget pane (and the dock and React Native sheet) through the existing `ask_user` form; typing a reply denies with your note passed to the agent. An unanswered prompt is denied after 5 minutes, or straight away when the run is stopped, so the agent moves on instead of hanging. "Allow for this run" applies the SDK's suggested rule for the current session only and never writes your settings files. Dry-run mode still hard-denies every edit, command and plan-mode exit. This also makes "Require approval" mode work as described: each edit now pauses for your approval rather than being refused. Asks closed without an answer now retire their form instead of blocking the follow-up box.
