# 002 — RN: keep the draft when submit fails

- **Priority:** P1 (active data loss)
- **Packages:** `@pinagent/react-native` (`packages/react-native`)
- **Zone:** Apache-2.0 — SPDX header on line 1 of new files
- **Changeset:** not required (package is changeset-ignored)
- **Related:** do together with [001](001-rn-restore-conversations-after-reload.md) (same files); read `/todo/README.md` ground rules first

## Context

`onSubmit` in `packages/react-native/src/native/Pinagent.tsx:207-245` clears the composer
**unconditionally** after `submitFeedback()` returns:

```ts
const result = await submitFeedback({ ... });
setComment('');   // ← runs even when result.ok === false
setPick(null);
setShot(null);
setPhase('idle');
...
setToast(result.ok ? 'Sent' : `Failed: ${result.error ?? 'unknown'}`);
```

`submitFeedback` (`packages/react-native/src/native/transport.ts:86-106`) returns
`{ ok: false, error }` on network failure or missing dev server. So a Metro restart, a brief
network blip, or a release build at the moment of submit throws away the typed comment, the
picked anchor, and the screenshot — the user gets a 2.5s toast and starts over. The web
widget never destroys composer state on a failed POST.

## Expected behavior

A failed submit keeps the composer exactly as it was — comment text, picked element/anchor,
screenshot — shows an inline error with the failure reason, and offers a one-tap **Retry**.
Success behaves as today.

## Implementation notes

1. In `onSubmit`, only clear `comment`/`pick`/`shot` when `result.ok` is true. On failure,
   set `phase` back to an error-ish idle state (reuse `phase` or add `'error'`), keep the
   composer open, and surface `result.error` inline (not just the transient toast).
2. Retry = re-invoke `onSubmit` with the retained state. The screenshot was captured at pick
   time (`shot`), so retry does not need to re-capture.
3. Optional, cheap resilience: one automatic retry after ~1s on network-type failures before
   surfacing the error. Keep it simple — no persistent outbox (see Out of scope).
4. Keep the existing release-build message ("No dev server (release build?)",
   `transport.ts:88-89`) verbatim — it's load-bearing for diagnosing release builds.

## Acceptance criteria

- [ ] Kill Metro, submit a comment in `examples/expo-app`: the comment, anchor breadcrumb,
      and screenshot remain in the composer with a visible error + Retry.
- [ ] Restart Metro, tap Retry: feedback POSTs, stream sheet opens (inline mode) — i.e. the
      retained payload is byte-equivalent to a fresh submit.
- [ ] Successful submit path unchanged (composer clears, pill/sheet appears).

## Test plan

Extract the submit-outcome state transition into a pure helper (input: current composer
state + `SubmitResult`; output: next composer state) and unit-test it in
`packages/react-native/tests/` — RN runtime/UI itself is not unit-testable in this repo.
Manual verify per acceptance criteria against `examples/expo-app`.

## Out of scope

- A persistent outbox (drafts surviving app reload / queued offline submits). The realistic
  failure window is a dev-server restart measured in seconds; in-session retention + retry
  covers it without new storage dependencies.
- Web-widget outbox for failed POSTs (tracked as a noted weakness in the audit; open a
  separate ticket if it ever bites).
