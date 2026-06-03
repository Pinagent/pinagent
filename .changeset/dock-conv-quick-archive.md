---
"@pinagent/widget-dock": minor
---

Conversations list: per-row quick archive / unarchive.

Each conversation row now has a hover- (and focus-) revealed archive
button, so a single conversation can be archived or unarchived in one
click — without opening its detail view or going through multi-select and
the bulk bar. Reuses the existing `updateConversation` path, so the row
drops out (or reappears under "Show archived") live, and the action is
recorded in History → Activity.
