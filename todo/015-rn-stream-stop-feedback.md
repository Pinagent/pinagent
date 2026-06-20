# 015 — RN: surface interrupt (Stop) feedback in the stream sheet

- **Priority:** P2
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0
- **Changeset:** not required (package is changeset-ignored)
- **Read `/todo/README.md` ground rules first**

## Context

The expanded `StreamSheet` "Stop" button fires `clientRef.current?.interrupt()`
(`packages/react-native/src/native/StreamSheet.tsx:288`), which sends a
fire-and-forget `interrupt` frame over the WS (`ws-client.ts:88`). Nothing in the
UI changes when it's tapped: the run state stays `working`/`awaiting` until the
server eventually emits a terminal `result`/`error` (or never, if the interrupt
is dropped while the socket is mid-reconnect — `send()` no-ops when the socket
isn't `OPEN`, `ws-client.ts:154`). The developer gets no confirmation the stop
was even sent, and can tap it repeatedly.

This was noticed during the agent-dock state rehaul (the dock now derives state
from `run-state.ts`, but there's no `interrupting` state — Stop is invisible).

## Expected behavior

Tapping Stop gives immediate feedback: the button shows an "Interrupting…"
state (disabled) until a terminal event lands, and the dock chip reflects it. If
the interrupt couldn't be sent (socket not open), say so rather than silently
no-op.

## Implementation notes

1. Have `StreamClient.interrupt()` return whether the frame was actually written
   (thread the boolean out of the private `send()`), so the UI can distinguish
   "sent, awaiting teardown" from "couldn't send".
2. Add a local `interrupting` flag in `StreamSheet`, set on a successful Stop and
   cleared by the next terminal event (`result`/`error`/`done`). Consider
   modeling it in the pure `run-state.ts` as an input rather than a new
   `RunState` member — keep the five-state enum, add an `interrupting` overlay
   the presentation can render (e.g. label "Stopping…", non-pulsing) so it stays
   unit-testable.
3. Disable the Stop button while `interrupting` to stop repeat taps.
4. Don't invent a server contract — the existing `interrupt` frame is enough; this
   is purely client-side affordance.

## Acceptance criteria

- [ ] Tapping Stop on a live run in `examples/expo-app` immediately shows an
      interrupting affordance and disables the button.
- [ ] When the socket isn't open, Stop reports it can't (no silent no-op).
- [ ] The interrupting affordance clears once the run reaches a terminal event.
- [ ] Any new state logic is covered by pure tests in `run-state` (no RN runtime).

## Out of scope

- Server-side interrupt semantics (already implemented in agent-runner).
- A confirmation dialog before stopping.
