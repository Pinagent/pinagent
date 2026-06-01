---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

fix(widget): make dock shortcuts work across iframe focus boundaries

Keyboard shortcuts are registered per JS realm (host document, dock iframe,
composer iframe) and iframe keystrokes never bubble to the host, so a shortcut
only fired when focus happened to sit in the realm that handled it. Two gaps
are closed:

- **Cmd/Ctrl+Shift+P now toggles the dock from a spawned agent.** The composer
  iframe (a spawned agent's UI) handled `Esc` / `c` / `Shift+N` / `Ctrl+\`` but
  not the dock toggle, so the shortcut was dead while focus was inside it. It
  now relays to the dock like the other composer-iframe shortcuts.
- **Pressing the pick hotkey (`c`) while the dock is open now opens a usable
  picker.** Entering the picker hides the dock iframe (rather than closing it,
  so the dock's React tree and any unsaved reply draft survive) so a
  fullscreen/floating dock no longer occludes the page being picked; it is
  restored when picking ends.
