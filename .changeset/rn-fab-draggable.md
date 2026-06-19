---
'@pinagent/react-native': minor
---

feat(react-native): make the feedback FAB draggable

The 💬 floating action button can now be dragged anywhere on screen, so it
can be moved off whatever control the developer wants to comment on. A single
PanResponder discriminates a stationary tap (still arms picking) from a drag
(relocates the button), the position stays clamped on-screen across rotations,
and it resets to the bottom-right corner on reload (RN keeps no device store).
