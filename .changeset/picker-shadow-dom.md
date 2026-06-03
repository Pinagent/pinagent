---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---

Fix the element picker not resolving targets inside open shadow DOM. `document.elementFromPoint` returns a web component's shadow *host*, so clicking a control inside a component library (or any shadow tree) mis-anchored the feedback to the enclosing host element — or none. The picker now descends through open shadow roots to the real leaf. (The fix is in the bundled `@pinagent/widget`, so both plugins re-embed it.)
