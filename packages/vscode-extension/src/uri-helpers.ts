// SPDX-License-Identifier: Apache-2.0
/**
 * Pure helpers for the `pinagent://` URI handler, kept free of any
 * `vscode` import so they can be unit-tested outside the extension host.
 * `extension.ts` re-uses these for `open-claude` / `open-file`.
 */

/**
 * Decode a prompt the dock encoded as `base64url(utf8(text))`. The
 * base64url shape lets newlines and shell metacharacters survive the URL
 * trip without escaping. Returns `''` for missing or undecodable input —
 * the caller treats an empty prompt as "just launch `claude`".
 */
export function decodePrompt(raw: string | null): string {
  if (!raw) return '';
  try {
    return Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Clamp a parsed line/column to a positive integer, falling back when the
 * value is non-finite (NaN from a bad `parseInt`) or non-positive. Editors
 * are 1-based, so `fallback` is normally 1.
 */
export function clampPositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
