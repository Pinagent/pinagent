// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode';

// Single VSCode terminal reused across invocations. We keep one named
// terminal so repeated clicks from the dock don't accumulate dozens of
// "Pinagent → Claude" tabs. If the user closes it we lazily make a
// new one on the next URI.
let terminal: vscode.Terminal | null = null;

// Delay before sending the prompt to a freshly-spawned `claude` process.
// `claude` prints its banner + waits for the TTY to settle; sending too
// early lands the prompt mid-banner where it gets clobbered. 1500ms is
// a conservative POC value — we can replace this with a readiness probe
// later if it proves flaky.
const PROMPT_DELAY_MS = 1500;

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        // VSCode delivers the URI as `pinagent.pinagent-vscode/<path>?<query>`
        // — `uri.path` includes the leading slash, so strip it before matching.
        const action = uri.path.replace(/^\//, '');
        switch (action) {
          case 'open-claude':
            return handleOpenClaude(uri);
          default:
            void vscode.window.showWarningMessage(`Pinagent: unknown URI action "${action}"`);
        }
      },
    }),
  );
}

export function deactivate(): void {
  terminal?.dispose();
  terminal = null;
}

function handleOpenClaude(uri: vscode.Uri): void {
  const params = new URLSearchParams(uri.query);
  const prompt = decodePrompt(params.get('prompt'));

  const term = ensureTerminal();
  term.show(true);
  term.sendText('claude', true);

  if (prompt) {
    // Wait for the banner before typing — see PROMPT_DELAY_MS comment.
    // `sendText(text, false)` types without pressing Enter so the user
    // can review/edit before submitting.
    setTimeout(() => {
      term.sendText(prompt, false);
    }, PROMPT_DELAY_MS);
  }
}

function ensureTerminal(): vscode.Terminal {
  // VSCode invalidates the Terminal handle when the tab is closed but
  // doesn't fire any disposal event we can listen to cheaply, so probe
  // `exitStatus` — it's undefined while alive, set when killed.
  if (terminal && terminal.exitStatus === undefined) {
    return terminal;
  }
  terminal = vscode.window.createTerminal({ name: 'Pinagent → Claude' });
  return terminal;
}

function decodePrompt(raw: string | null): string {
  if (!raw) return '';
  // The dock encodes prompts with `base64url(utf8(text))` so newlines
  // and shell metacharacters survive the URL trip without escaping.
  try {
    return Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return '';
  }
}
