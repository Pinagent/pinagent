---
'@pinagent/react-native': patch
---

fix(react-native): re-anchor onto a real source location when pressing any breadcrumb

Previously only the initially-tapped (innermost) breadcrumb showed a `file:line`
path; pressing an ancestor crumb to switch focus often fell back to a bare
component name. The tapped element resolved its location via `pickLoc`'s
owner-hierarchy walk, but per-crumb locations were read from each crumb's own
host props with no fallback, so an ancestor whose first host child is untagged
collapsed to `loc: null`. Each crumb now re-resolves to the nearest source in
the hierarchy (descendants first, then ancestors), so re-focusing onto any
breadcrumb anchors the comment — and the "open in editor" link — onto the actual
code snippet.
