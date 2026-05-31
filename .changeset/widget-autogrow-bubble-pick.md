---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

fix(widget): composer auto-grow, dot needs-input state, pick-into-draft

Three follow-on fixes to the spawned-agent widget:

- **Auto-grow no longer runs away.** The pre-submit composer textarea is
  `flex: 1`, so measuring its `scrollHeight` reported the flex-filled height,
  which grew the iframe, which re-filled the textarea — looping bigger on every
  keystroke. The measure now drops the textarea out of flex to an auto height,
  so it reflects the content and settles (capped at MAX_TA_H).
- **Collapsed dot:** the running spinner is smaller, and when the agent asks a
  question (`ask_user`) the dot now shows a distinct needs-input state (alert
  glyph + attention pulse) instead of the spinner, mirroring the minimal bar.
- **Adding an element when idle opens a draft.** Picking another element after
  the agent finished no longer auto-fires a bare "Also look at this…" turn; it
  attaches the element as a removable pill and focuses the follow-up input so
  you can describe the change, then folds the element reference into your
  message on send. Mid-turn picks still queue as before.
