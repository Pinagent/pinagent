---
"@pinagent/vite-plugin": patch
"@pinagent/next-plugin": patch
---
Make the composer header breadcrumbs hoverable and pressable. Hovering any
crumb flashes the matching element on the page; clicking an ancestor crumb
re-focuses the comment onto that ancestor without re-picking, carrying the
in-progress draft, extras and regions across. The affordance is only live on
a fresh, unbound pick — once the conversation is submitted the breadcrumb
reverts to a plain, non-interactive label.
