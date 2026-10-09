---
"@pinagent/vite-plugin": minor
"@pinagent/next-plugin": minor
"@pinagent/react-native": minor
"@pinagent/widget-dock": minor
---

The default permission mode is now the Claude Agent SDK's real auto mode. Previously the "auto" project setting (labelled "Auto-accept edits") ran the SDK's `acceptEdits`, so every Bash command that wasn't pre-allowed — including anything with `$(…)` — sat on a permission prompt until someone answered it or it timed out after 5 minutes. Now "auto" (labelled "Auto (classifier)") lets the SDK's classifier approve or block each tool call; only the calls it can't decide raise a prompt in the widget, dock or React Native sheet. Saved `.pinagent/config.json` files with `"permissionMode": "auto"` get the classifier too. To keep the old behaviour, pick the new "Auto-accept edits" mode (`accept-edits`) in dock Settings, or set `PINAGENT_AGENT_PERMISSION_MODE=acceptEdits`. `PINAGENT_AGENT_PERMISSION_MODE=auto` also means the classifier, and an unrecognised value now falls back to `auto`. Where auto mode isn't available (for your plan, the chosen model, or a `disableAutoMode` setting), the Claude Code CLI starts the run in `default` mode. Pinagent then switches the run to `acceptEdits` and adds a note to the run log, so the run doesn't fail and edits don't each start prompting. Tool calls the classifier denies now show up in the run log with its reason.
