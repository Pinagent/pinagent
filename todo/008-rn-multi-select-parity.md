# 008 — RN: multi-select parity (`additional_anchors`)

- **Priority:** P2
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0
- **Changeset:** not required (package is changeset-ignored)
- **Read `/todo/README.md` ground rules first**

## Context

On web, Cmd/Ctrl-click accumulates multiple elements into one comment
(`packages/widget/src/picker.ts:56-70` `PendingElement` accumulation); extras are submitted
as `extraAnchors` and land in the `widget_anchors.additional_anchors` JSON column (covered
by `packages/widget/tests/db.test.ts:73-124`). Agents receive them as `additionalTargets`
(the MCP channel contract instructs agents to address the primary target AND every
additional location).

RN is single-pick by design-cut: `onPickTap` resolves exactly one element
(`packages/react-native/src/native/Pinagent.tsx:140-165`), and the v1 docs note the field is
"schema-compatible, left empty" (`packages/react-native/README.md:90`,
`docs/architecture/react-native.md:194`). The schema, server, MCP surface, and agent-side
handling all already work — only the RN capture UX is missing. A comment like "make all
these buttons match" can't be filed from RN today.

## Expected behavior

From the RN composer, the user can add further elements to the same comment before
submitting: re-enter pick mode, tap another element, see all targets as removable chips, and
submit one feedback whose `extraAnchors` carries every non-primary target. Single-pick flow
is unchanged (and `additional_anchors` stays null — the web semantics,
`db.test.ts:105-124`).

## Implementation notes

1. **UX (suggested):** an "+ Add element" affordance in the composer → temporarily hide the
   composer modal, re-enter picking (reuse the existing pick flow + highlight), and on tap
   return to the composer with the new target appended. Render targets as chips
   (primary first, each removable). Desktop-style Cmd-click doesn't map to touch — don't
   chase the web gesture, match the *capability*.
2. **Payload:** primary stays as today (`loc`, `selector`, breadcrumb-selected); build
   `extraAnchors` from the additional picks with the same per-anchor shape the web sends in
   `FeedbackInput` (see the zod `FeedbackInputSchema` in `@pinagent/agent-runner` for the
   exact field shape — RN's `submitFeedback` in
   `packages/react-native/src/native/transport.ts:86-106` already posts that schema).
3. **Re-anchoring/breadcrumb:** breadcrumb ancestor re-selection applies to the primary
   anchor only (web behaves the same); extras keep the loc they were tapped with.
4. Keep state in `Pinagent.tsx` alongside `pick`/`shot`; clearing rules follow ticket
   [002](002-rn-failed-submit-draft-retention.md) (extras survive a failed submit too — if
   002 isn't merged yet, coordinate; these touch the same `onSubmit`).
5. Screenshot: one screenshot per feedback (captured at first pick) is correct — extras
   don't re-capture (web parity).

## Acceptance criteria

- [ ] Multi-pick in `examples/expo-app` produces one feedback row whose
      `additional_anchors` JSON lists every extra target (inspect `.pinagent/db.sqlite` or
      `GET /__pinagent/feedback/:id`).
- [ ] MCP `get_feedback` for that id surfaces the additional targets to the agent.
- [ ] Removing a chip before submit excludes it; single-pick submits leave
      `additional_anchors` null.
- [ ] No RN-runtime imports leak into unit-testable modules.

## Test plan

Pure parts only (RN runtime is not unit-testable in this repo): extract the
"picks → FeedbackInput payload" builder into a pure function and test it in
`packages/react-native/tests/` (empty extras → omitted; ordering; chip removal). End-to-end
manually against `examples/expo-app` per acceptance criteria.

## Out of scope

- Web-style modifier-key picking on RN, keyboard navigation (separate audit item, low
  priority), and any server/schema work (none needed — already shipped).
