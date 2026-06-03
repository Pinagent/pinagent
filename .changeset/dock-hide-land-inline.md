---
"@pinagent/widget-dock": patch
---

Conversation detail: hide Land / Discard / Create-PR for inline-mode runs.

Inline-mode conversations never get a worktree (the agent edits the
working tree directly), so there's nothing to land, discard, or open a PR
from. Those three controls used to render in a disabled state next to the
Stop button while an inline agent was running, because the action row was
gated partly on "a turn is in flight". They're now gated on the
conversation actually having a worktree — inline runs show only Stop.
