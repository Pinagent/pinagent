---
'@pinagent/react-native': patch
---

fix(react-native): actually engage the measure-based hit-test on pager pages

The pager fallback shipped in 0.2.4 never fired: it was gated on
`tappedLeafLoc(data)` being null, but that walks UP the touched host's fiber
`return` chain, and a pager page's authored ancestors (the `<MaterialTopTabs>`
in the screen layout) are tagged — so it always resolved a (wrapper) source and
the downward measure DFS was skipped. Taps on widgets inside a
`react-native-pager-view` page still selected the full-screen scene wrapper.

Now the DFS runs on every pick from the natively-hit host and overrides only
when it descends to a tagged host *below* that host (`hit.fiber !== nativeLeaf`).
Off the pager the native hit-test already reached the leaf, so the DFS bottoms
out at that same fiber and the existing native path is used unchanged — no
regression on screens that already resolve correctly.
