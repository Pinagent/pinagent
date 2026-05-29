---
"@pinagent/next-plugin": patch
"@pinagent/vite-plugin": patch
---

Fix the minimized agent progress card clipping its status line. The mini
card's content was a few pixels taller than its fixed height, so flexbox
shrank the `overflow: hidden` header and sheared the "Working · model · id"
text and spinner. The card now hugs its content height, and the header /
context lines are pinned so they can never become flex-shrink victims.
