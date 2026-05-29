// SPDX-License-Identifier: Apache-2.0
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, resolve, sep } from 'node:path';

/**
 * Resolve the editor command. Honors (in order):
 *   1. PINAGENT_EDITOR — pinagent-specific override
 *   2. EDITOR / VISUAL — standard *nix env vars
 *   3. 'code' — VSCode CLI, the most common default
 */
export function detectEditor(env: NodeJS.ProcessEnv): string {
  return env.PINAGENT_EDITOR || env.EDITOR || env.VISUAL || 'code';
}

interface Command {
  cmd: string;
  args: string[];
}

/**
 * Build the right CLI invocation for the chosen editor.
 *
 * Most modern code editors accept `-g file:line:col` (VSCode lineage).
 * JetBrains tools use `--line` and `--column` flags. Sublime takes
 * `file:line:col` without a flag. Fallback: pass just the file path.
 */
export function buildCommand(editor: string, file: string, line?: number, col?: number): Command {
  const name = editor.split(/[\\/]/).pop()?.toLowerCase() ?? editor.toLowerCase();

  const locator =
    line != null && col != null
      ? `${file}:${line}:${col}`
      : line != null
        ? `${file}:${line}`
        : file;

  // VSCode lineage + a few others that support -g file:line:col
  if (['code', 'code-insiders', 'cursor', 'windsurf', 'codium', 'vscodium'].includes(name)) {
    return { cmd: editor, args: ['-g', locator] };
  }
  if (name === 'zed') {
    return { cmd: editor, args: [locator] };
  }
  // Sublime
  if (name === 'subl' || name === 'sublime_text') {
    return { cmd: editor, args: [locator] };
  }
  // JetBrains family
  if (
    ['idea', 'webstorm', 'pycharm', 'rubymine', 'phpstorm', 'goland', 'rider', 'clion'].includes(
      name,
    )
  ) {
    const args = [file];
    if (line != null) args.push('--line', String(line));
    if (col != null) args.push('--column', String(col));
    return { cmd: editor, args };
  }
  // Atom (rip), TextMate
  if (name === 'atom' || name === 'mate') {
    return { cmd: editor, args: [locator] };
  }
  // Fallback: just open the file
  return { cmd: editor, args: [file] };
}

export interface OpenInEditorResult {
  ok: true;
  editor: string;
  command: string;
}

export async function openInEditor(
  projectRoot: string,
  file: string,
  line: number | undefined,
  col: number | undefined,
): Promise<OpenInEditorResult> {
  if (file.includes('..')) throw new Error('path traversal not allowed');
  const abs = isAbsolute(file) ? file : resolve(projectRoot, file);
  const rootAbs = resolve(projectRoot);
  if (!abs.startsWith(rootAbs + sep) && abs !== rootAbs) {
    throw new Error('path outside project root');
  }
  if (!existsSync(abs)) throw new Error(`file not found: ${file}`);

  const editor = detectEditor(process.env);
  const { cmd, args } = buildCommand(editor, abs, line, col);

  await new Promise<void>((resolveP, reject) => {
    let settled = false;
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    // `code -g` returns near-immediately, so we resolve on a short timer
    // rather than waiting for `exit` (which fires when the editor closes).
    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.unref();
      resolveP();
    }, 200);
  });

  return { ok: true, editor, command: `${cmd} ${args.join(' ')}` };
}
