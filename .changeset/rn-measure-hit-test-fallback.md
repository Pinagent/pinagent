---
"@pinagent/react-native": patch
---

fix(react-native): resolve taps inside react-native-pager-view (and other native-hosted content) via a measure fallback

Tapping a widget on a screen rendered through `react-native-pager-view` (e.g. a
`MaterialTopTabs` pager) selected a full-screen wrapper instead of the element
under the finger — RN's **own** built-in inspector hits the same wall. The
pager hosts each page's views in a native container (UIPageViewController),
which detaches them from the Fabric shadow tree that
`getInspectorDataForViewAtPoint`'s geometric `findNodeAtPoint` walks, so the
native hit-test bottoms out at the page's scene wrapper and never reaches the
tagged widget.

The React **fiber** tree is intact, though, and the widgets are on-screen and
measurable. So when the native hit-test fails to land on a tagged element
(`tappedLeafLoc` is null), `resolvePick` now falls back to a measure-based
hit-test: it DFS-walks the fiber subtree under the touched host, calls
`measureInWindow` on each host, and returns the deepest tagged host whose window
frame contains the tap (pruned like `elementFromPoint`). The breadcrumb is
rebuilt from that leaf's `data-pa-loc`/`data-pa-comp` ancestry.

The fallback is gated on the native hit-test failing, so every screen that
already resolved correctly keeps its exact existing path; the new code only runs
for the previously-unreachable case. Pure traversal (`measureHitTest`,
`taggedAncestors`, `frameContains`) is unit-tested with synthetic fiber trees;
the `measureInWindow` bridge degrades to the prior behavior when unavailable.
