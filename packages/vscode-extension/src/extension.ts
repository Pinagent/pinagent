// SPDX-License-Identifier: Apache-2.0
import * as vscode from 'vscode';
import { clampPositive, decodePrompt } from './uri-helpers';
import { PresenceClient } from './ws-presence';

// Best-effort presence connection to the dev-server's WS bridge. Lets
// the dock detect that the extension is installed (see ws-presence.ts).
let presence: PresenceClient | null = null;

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
  // Announce presence to any running pinagent dev-server so its dock can
  // tell the developer the extension is installed. Version comes from the
  // manifest VSCode parsed at load time. Best-effort: no server → quiet
  // retries (see PresenceClient).
  const version =
    typeof context.extension.packageJSON?.version === 'string'
      ? context.extension.packageJSON.version
      : '0.0.0';
  presence = new PresenceClient(version);
  presence.start();
  context.subscriptions.push({ dispose: () => presence?.dispose() });

  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        // VSCode delivers the URI as `pinagent.pinagent-vscode/<path>?<query>`
        // — `uri.path` includes the leading slash, so strip it before matching.
        const action = uri.path.replace(/^\//, '');
        switch (action) {
          case 'open-claude':
            return handleOpenClaude(uri);
          case 'open-file':
            return handleOpenFile(uri);
          case 'view-changes':
            return handleViewChanges();
          default:
            void vscode.window.showWarningMessage(`Pinagent: unknown URI action "${action}"`);
        }
      },
    }),
  );
}

export function deactivate(): void {
  presence?.dispose();
  presence = null;
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

/**
 * Focus VSCode's Source Control view so the developer sees every changed
 * file at once. Backs the dock dashboard's "Open in VSCode" action.
 * `workbench.view.scm` is a built-in command — no SCM provider config
 * needed, it reveals the panel git already populates.
 */
function handleViewChanges(): void {
  void vscode.commands.executeCommand('workbench.view.scm');
}

async function handleOpenFile(uri: vscode.Uri): Promise<void> {
  const params = new URLSearchParams(uri.query);
  const path = params.get('path');
  const line = clampPositive(parseInt(params.get('line') ?? '1', 10), 1);
  const col = clampPositive(parseInt(params.get('col') ?? '1', 10), 1);

  if (!path) {
    void vscode.window.showWarningMessage('Pinagent: open-file requires a `path` query parameter.');
    return;
  }

  // Resolve against the first open workspace folder when the path is
  // relative. Pinagent stores project-relative locations (data-pa-loc
  // is "src/Foo.tsx:42:8"), so this is the common case. Absolute paths
  // pass through untouched so the same handler also serves "open this
  // file by its full disk path" callers.
  const target = resolveAgainstWorkspace(path);
  if (!target) {
    void vscode.window.showWarningMessage(
      `Pinagent: no workspace folder is open — cannot resolve "${path}".`,
    );
    return;
  }

  try {
    const doc = await vscode.workspace.openTextDocument(target);
    const zeroBased = new vscode.Position(line - 1, col - 1);
    await vscode.window.showTextDocument(doc, {
      selection: new vscode.Range(zeroBased, zeroBased),
      preserveFocus: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    void vscode.window.showWarningMessage(`Pinagent: couldn't open ${path} — ${message}`);
  }
}

function resolveAgainstWorkspace(path: string): vscode.Uri | undefined {
  if (path.startsWith('/')) return vscode.Uri.file(path);
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return undefined;
  return vscode.Uri.joinPath(folder.uri, path);
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
