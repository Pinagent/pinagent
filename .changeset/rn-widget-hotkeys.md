---
"@pinagent/react-native": patch
---

feat(react-native): keyboard shortcuts in the widget

Brings the browser widget's hardware-keyboard shortcuts to React Native, scoped
to where RN can actually surface key events — the modal composer and the live
stream sheet (no native module, no setup):

- **Enter** submits the agent answer and the follow-up in the stream sheet (via
  `onSubmitEditing`; `submitBehavior="submit"` keeps the keyboard up so several
  can be queued in a row).
- **Escape** backs out — cancels the composer and minimizes the stream sheet —
  mirroring the web widget's Escape.

Hardware Back (Android) already dismisses both modals via `onRequestClose` and is
unchanged. The truly global web hotkeys (`c` to pick, Shift+N hop, Ctrl+\`
minimize-all) aren't ported: RN has no JS-level global key stream, so they'd need
a native module, which the source-only RN widget deliberately avoids. The
composer stays multiline (Enter inserts a newline) because RN's `onKeyPress`
can't see Shift to tell submit from newline.
