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
 * Fire the URI. Browsers handle the `vscode://` scheme out-of-band:
 * the first hit prompts the user to allow VSCode to open, subsequent
 * hits go through silently. No-op on platforms without VSCode.
 *
 * We click a transient anchor instead of setting `location.href` so the
 * dock iframe doesn't trip its router on the scheme change before the
 * browser intercepts it.
 */
export function openInClaudeCode(prompt: string): void {
  const uri = buildOpenClaudeUri(prompt);
  const link = document.createElement('a');
  link.href = uri;
  link.rel = 'noopener noreferrer';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
