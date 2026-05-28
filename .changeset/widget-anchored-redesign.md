---
'@pinagent/next-plugin': patch
'@pinagent/vite-plugin': patch
---

Redesign the anchored composer header and add quick-action chips.

The widget that pops up next to a clicked element now leads with the
picked element's identity (tag pill + quoted label), then the file
location, then a DOM breadcrumb where the picked element is highlighted.
Below the header sits a row of starter-prompt chips ("Change text",
"Recolor", "Add hover state", "Resize", "Make it a link") that prefill
the textarea so common edits skip the cold start. A "⌘↵ submit · esc
cancel" hint replaces the bare button row in the footer.

The submit binding moved from plain Enter to ⌘/Ctrl+Enter to match the
hint — plain Enter now inserts a newline, which fits the longer prompts
the new composer encourages.

Brand colors are unchanged (cream/ink/gold); pure structural redesign.
Both plugins embed the widget IIFE at build time, so the bundled bytes
change even though no plugin source did — hence the patch bump.
