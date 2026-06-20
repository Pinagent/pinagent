# 016 — RN: ask-options overflow pushes the input off-screen

- **Priority:** P3
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0
- **Changeset:** not required (package is changeset-ignored)
- **Read `/todo/README.md` ground rules first**

## Context

When the agent calls `ask_user` with options, the expanded `StreamSheet` renders
them as a wrapping row of bordered buttons
(`packages/react-native/src/native/StreamSheet.tsx:226`, style `options` at
`:349` — `flexWrap: 'wrap'`, no max-height). The whole answer form sits in a
fixed `inputBar` below a `maxHeight: '80%'` sheet. A question with many options
(10+, or a few very long ones) wraps into a tall block that pushes the text input
and Send button below the fold — and with the soft keyboard up, off-screen — so
the developer can't type a free-text answer or reach Send.

## Expected behavior

However many options an `ask_user` carries, the text input and Send stay
reachable: the options area is height-bounded and scrolls, the form never
exceeds the sheet, and the input remains visible with the keyboard up.

## Implementation notes

1. Cap the options container height and make it scroll (a small `ScrollView` or
   `maxHeight` + `flexShrink`), keeping the text input + Send pinned below it.
2. Verify against the keyboard inset path the composer already uses
   (`useKeyboardHeight` in `Pinagent.tsx`) — the stream sheet is a separate
   `Modal` and may need the same treatment if the input is obscured.
3. Long single options should truncate/ellipsize rather than force the row wide.

## Acceptance criteria

- [ ] An `ask_user` with ~15 options in `examples/expo-app` keeps the text input
      and Send visible and usable (keyboard up included).
- [ ] Options remain individually tappable (scroll if needed).
- [ ] Short-option asks look unchanged.

## Out of scope

- Redesigning the option control styling.
- Multi-select answers (asks are single-answer today).
