---
"@pinagent/react-native": patch
---

feat(react-native): brand the widget FAB with the pinagent pin and colours

The native floating action button showed a 💬 emoji on a neutral charcoal
circle that turned blue while picking. It now renders the canonical pinagent
pin mark (cream on the brand ink surface) and uses a gold ring for the active
picking state — matching the web widget FAB.

The pin is drawn with `react-native-svg` (added as an *optional* peer, lazily
required like `react-native-view-shot`, so release builds never pull it in).
When the peer isn't installed the FAB falls back to a View-drawn teardrop in
the same brand colour, so it always shows a pin rather than a generic glyph.
