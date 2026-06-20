---
'@pinagent/react-native': patch
---

fix(react-native): resolve taps inside react-native-pager-view pages to the widget

Taps on dashboard widgets inside a `react-native-pager-view` page (e.g. a
`MaterialTopTabs` swipeable day dashboard) resolved to the full-screen scene
wrapper instead of the tapped widget. The measure fallback shipped in 0.2.4
never helped because it was rooted at `closestPublicInstance` — and RN's native
hit-test returns **no** touched instance for a pager page (its native views are
detached from the Fabric shadow tree the hit-test walks), so there was nothing
to walk.

Two fixes:

- **Root the measure DFS at the app root** when the native hit-test resolves no
  instance (`closestPublicInstance` is null), instead of at the (null) touched
  instance. The app root is an ancestor of every on-screen view in the
  still-intact fiber tree. Gated on the native hit-test failing, so every screen
  where it succeeds keeps its existing native path — no regression.

- **Descend through flattened / detached hosts.** RN flattens layout-only
  `<View>`s (no native view → unmeasurable) and detaches pager pages, so a
  widget's own tagged hosts often can't be measured and geometry bottoms out at
  the outermost non-flattened wrapper (the animated card every widget shares).
  Once inside a measurable containing region the DFS now keeps recording tagged
  hosts even when they can't be measured (borrowing the region's frame for the
  highlight), so different widgets resolve to their own sources. Measurable
  siblings still prune wrong branches, so the tap stays within the tapped card.
