// SPDX-License-Identifier: Apache-2.0
/**
 * Editor command building: `detectEditor` precedence, the per-editor CLI
 * dispatch (`buildCommand`), and `openInEditor`'s path-traversal /
 * out-of-root / missing-file guards. The actual detached spawn is not
 * exercised — it requires a real editor binary — but every code path that
 * runs *before* the spawn is.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildCommand, detectEditor, openInEditor } from '../src/editor';

describe('detectEditor', () => {
  it('prefers PINAGENT_EDITOR over EDITOR/VISUAL', () => {
    expect(detectEditor({ PINAGENT_EDITOR: 'subl', EDITOR: 'vim', VISUAL: 'nano' })).toBe('subl');
  });

  it('falls back through EDITOR then VISUAL then code', () => {
    expect(detectEditor({ EDITOR: 'vim', VISUAL: 'nano' })).toBe('vim');
    expect(detectEditor({ VISUAL: 'nano' })).toBe('nano');
    expect(detectEditor({})).toBe('code');
  });
});

describe('buildCommand', () => {
  it('uses -g file:line:col for the VSCode lineage', () => {
    for (const ed of ['code', 'code-insiders', 'cursor', 'windsurf', 'codium', 'vscodium']) {
      expect(buildCommand(ed, '/p/Foo.tsx', 12, 3)).toEqual({
        cmd: ed,
        args: ['-g', '/p/Foo.tsx:12:3'],
      });
    }
  });

  it('drops the column then the line as they go missing', () => {
    expect(buildCommand('code', '/p/Foo.tsx', 12)).toEqual({
      cmd: 'code',
      args: ['-g', '/p/Foo.tsx:12'],
    });
    expect(buildCommand('code', '/p/Foo.tsx')).toEqual({ cmd: 'code', args: ['-g', '/p/Foo.tsx'] });
  });

  it('uses --line/--column flags for the JetBrains family', () => {
    expect(buildCommand('webstorm', '/p/Foo.tsx', 12, 3)).toEqual({
      cmd: 'webstorm',
      args: ['/p/Foo.tsx', '--line', '12', '--column', '3'],
    });
    // line only -> no --column.
    expect(buildCommand('idea', '/p/Foo.tsx', 12)).toEqual({
      cmd: 'idea',
      args: ['/p/Foo.tsx', '--line', '12'],
    });
  });

  it('passes a bare file:line:col locator for zed / sublime / atom / mate', () => {
    for (const ed of ['zed', 'subl', 'sublime_text', 'atom', 'mate']) {
      expect(buildCommand(ed, '/p/Foo.tsx', 12, 3)).toEqual({ cmd: ed, args: ['/p/Foo.tsx:12:3'] });
    }
  });

  it('falls back to just the file path for an unknown editor', () => {
    expect(buildCommand('myeditor', '/p/Foo.tsx', 12, 3)).toEqual({
      cmd: 'myeditor',
      args: ['/p/Foo.tsx'],
    });
  });

  it('resolves the editor basename from a full path, case-insensitively', () => {
    expect(buildCommand('/usr/local/bin/Code', '/p/Foo.tsx', 1, 1)).toEqual({
      cmd: '/usr/local/bin/Code',
      args: ['-g', '/p/Foo.tsx:1:1'],
    });
  });
});

describe('openInEditor guards', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pa-editor-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('rejects a path containing ".."', async () => {
    await expect(openInEditor(root, '../escape.ts', 1, 1)).rejects.toThrow(/path traversal/);
  });

  it('rejects an absolute path outside the project root', async () => {
    await expect(openInEditor(root, '/etc/hosts', 1, 1)).rejects.toThrow(/outside project root/);
  });

  it('rejects a file that does not exist inside the root', async () => {
    await expect(openInEditor(root, 'src/Missing.tsx', 1, 1)).rejects.toThrow(/file not found/);
  });

  it('does not flag a sibling dir that shares the root name prefix as in-root', async () => {
    // `${root}-evil` starts with the root string but is a sibling; the
    // `abs.startsWith(rootAbs + sep)` guard must reject it.
    await expect(openInEditor(root, `${root}-evil/x.ts`, 1, 1)).rejects.toThrow(
      /outside project root/,
    );
  });
});
