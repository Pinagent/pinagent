---
"@pinagent/react-native": patch
---

fix(react-native): resolve a tap to the leaf under the finger, not its parent

Tapping a nested element in the in-app picker selected its parent container
instead of the element actually touched. RN's `getInspectorDataForViewAtPoint`
does not hand back the tapped host's props: `getInspectorDataForInstance` walks
the **owner** tree up to the nearest non-host composite, then returns
`getHostProps(thatComposite)` — its **first host descendant** (the component's
outermost view) via `findCurrentHostFiber`. So a tap on, say, a card's content
whose JSX owner is the screen layout resolved to the layout's outer `<View>`
(e.g. `_layout.tsx:89`), and every leaf owned by that component collapsed to the
same container.

`pickLoc` now first reads the host actually under the finger — RN includes its
public instance as `closestPublicInstance` in the payload — bridges it to its
fiber and walks the render-tree parent (`return`) chain for the nearest
`data-pa-loc`: the tapped element itself, or the nearest authored element
enclosing it when that exact host is untagged. This mirrors the web widget
walking up the DOM from the clicked node. `data.props` and the owner-hierarchy
walk remain as fallbacks (e.g. Paper, which surfaces only a numeric view tag
that can't be bridged).
