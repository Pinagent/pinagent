// SPDX-License-Identifier: Apache-2.0

/**
 * Keyboard-shortcut helpers for the React Native widget.
 *
 * The browser widget wires its hotkeys to `document`-level `keydown`
 * listeners (see packages/widget/src/keyboard.ts). React Native has no such
 * global key stream in JS: the core `Keyboard` module only reports the soft
 * keyboard showing/hiding, never key presses, and there's no document to
 * listen on. A faithful port of the *global* web hotkeys (toggle picker,
 * hop-to-next-agent, minimize-all) would need a native module — iOS
 * `UIKeyCommand` / an Android key bridge — which we deliberately avoid: the RN
 * widget ships as plain JS source for Metro with zero native setup.
 *
 * What IS reachable, and all we need in practice, are the key events a focused
 * `TextInput` surfaces — so the shortcuts live where a hardware keyboard is
 * actually in play (the composer and the stream sheet, both modal):
 *   - Return/Enter, via `onSubmitEditing` on the single-line inputs — submits
 *     the agent answer and the follow-up, mirroring the web composer's
 *     Enter-to-send. Wired directly on the input (no key inspection needed).
 *   - Escape, via `onKeyPress` — backs out of a sheet, mirroring the web
 *     widget's Escape. Decided here so the (RN-runtime-only, untestable)
 *     components stay thin and the rule is unit-tested.
 *
 * `onKeyPress`'s `nativeEvent` only carries `key` on native platforms (no
 * modifier flags), so these predicates take the bare key name — there's no
 * Shift/Cmd to branch on, which is also why plain Enter stays a newline in the
 * multiline composer rather than hijacking submit. Hardware Back (Android) is
 * handled separately by each Modal's `onRequestClose`.
 */

/**
 * Should this key event back out of the current sheet? Escape on a hardware
 * keyboard — the RN analog of the web widget's Escape. Only the Escape key
 * qualifies; every printable key (i.e. normal typing) is ignored, so an
 * `onKeyPress` handler built on this never interferes with text entry.
 */
export function isDismissKey(key: string): boolean {
  return key === 'Escape';
}
