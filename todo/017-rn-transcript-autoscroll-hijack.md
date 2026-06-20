# 017 — RN: transcript auto-scroll hijacks manual scroll-back

- **Priority:** P3
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0
- **Changeset:** not required (package is changeset-ignored)
- **Read `/todo/README.md` ground rules first**

## Context

The expanded `StreamSheet` transcript auto-scrolls to the bottom on every content
change: `onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated:
true })}` (`packages/react-native/src/native/StreamSheet.tsx:162`). It fires
unconditionally, so if the developer scrolls up to re-read an earlier tool call
while the agent is still streaming, the next event yanks them back to the bottom
mid-read. On a long, active run this makes the transcript hard to read.

## Expected behavior

Auto-scroll only when the developer is already at (or near) the bottom — the
standard chat-log "stick to bottom unless I've scrolled up" behavior. Once they
scroll back down to the end, auto-follow resumes. (Optionally, a small "jump to
latest" affordance when pinned scrolled-up.)

## Implementation notes

1. Track an `atBottom` flag from the `ScrollView`'s `onScroll`
   (compare `contentOffset.y + layoutMeasurement.height` against
   `contentSize.height` within a small threshold; throttle via
   `scrollEventThrottle`). Only `scrollToEnd` on content change when `atBottom`.
2. Keep the initial mount / first-load scroll-to-end (so a freshly expanded sheet
   starts at the latest).
3. The flag/threshold check is pure — extract `isNearBottom({offsetY,
   viewportH, contentH, threshold})` into a testable helper (mirrors how
   `run-state`/`transcript` keep logic out of the RN layer) and unit-test it.

## Acceptance criteria

- [ ] Scrolling up during an active run in `examples/expo-app` is no longer
      interrupted by incoming events.
- [ ] Scrolling back to the bottom re-enables auto-follow.
- [ ] A freshly expanded sheet still opens scrolled to the latest output.
- [ ] The near-bottom predicate is covered by a pure unit test.

## Out of scope

- Virtualizing the transcript (`FlatList` migration) — separate perf item.
