// SPDX-License-Identifier: Apache-2.0

// vscode:// URI handlers route to the publisher.extension pair declared
// in the extension's package.json manifest. Keep this matched to
// `@pinagent/vscode-extension`'s `publisher` + `name` fields.
const VSCODE_EXTENSION_ID = 'pinagent.pinagent-vscode';

/**
 * Encode `text` for transport in a vscode:// query string. The extension
 * decodes the same way (base64url → utf8) so newlines and shell
 * metacharacters survive the round-trip without escaping.
 */
function encodePromptForUri(text: string): string {
  // btoa() only handles latin1; route through TextEncoder so non-ASCII
  // prompts (emoji, accented characters) don't throw.
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Build a vscode:// URI that, when handled, opens a terminal in VSCode
 * running `claude` and types `prompt` into it (without submitting).
 */
export function buildOpenClaudeUri(prompt: string): string {
  const encoded = encodePromptForUri(prompt);
  return `vscode://${VSCODE_EXTENSION_ID}/open-claude?prompt=${encoded}`;
}

/**
 * Build a vscode:// URI that opens `path` in VSCode at `line:col`. The
 * path is resolved against the first open workspace folder by the
 * extension — Pinagent stores project-relative locations, so the
 * common case is "src/Foo.tsx".
 */
export function buildOpenFileUri(path: string, line: number, col: number): string {
  const params = new URLSearchParams({
    path,
    line: String(line),
    col: String(col),
  });
  return `vscode://${VSCODE_EXTENSION_ID}/open-file?${params.toString()}`;
}

/**
 * Parse a `file:line:col` location string into its parts. Returns null
 * when the input isn't shaped like an anchor — callers can use that to
 * decide whether to render a jump affordance at all.
 */
export function parseAnchorLoc(loc: string): { path: string; line: number; col: number } | null {
  // Expect "<path>:<line>:<col>" where the path may itself contain colons
  // (e.g. Windows drive letters) but the trailing two colon-separated
  // segments are the numeric line + col. Read from the end so the path
  // parses correctly regardless of how many colons it contains.
  const lastColon = loc.lastIndexOf(':');
  if (lastColon === -1) return null;
  const secondLastColon = loc.lastIndexOf(':', lastColon - 1);
  if (secondLastColon === -1) return null;

  const path = loc.slice(0, secondLastColon);
  const line = parseInt(loc.slice(secondLastColon + 1, lastColon), 10);
  const col = parseInt(loc.slice(lastColon + 1), 10);

  if (!path || !Number.isFinite(line) || !Number.isFinite(col)) return null;
  return { path, line, col };
}

/**
 * Fire the URI. Browsers handle the `vscode://` scheme out-of-band:
 * the first hit prompts the user to allow VSCode to open, subsequent
 * hits go through silently. No-op on platforms without VSCode.
 *
 * We click a transient anchor instead of setting `location.href` so the
 * dock iframe doesn't trip its router on the scheme change before the
 * browser intercepts it.
 */
export function openInClaudeCode(prompt: string): void {
  fireVSCodeUri(buildOpenClaudeUri(prompt));
}

/**
 * Open `loc` (a "file:line:col" anchor string) in VSCode. Returns true
 * when the URI was fired, false when `loc` didn't parse — callers can
 * use that signal to decide whether to render the affordance at all.
 */
export function openAnchorInVSCode(loc: string): boolean {
  const parsed = parseAnchorLoc(loc);
  if (!parsed) return false;
  fireVSCodeUri(buildOpenFileUri(parsed.path, parsed.line, parsed.col));
  return true;
}

function fireVSCodeUri(uri: string): void {
  const link = document.createElement('a');
  link.href = uri;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
