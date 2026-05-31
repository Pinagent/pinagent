// SPDX-License-Identifier: Apache-2.0
/**
 * Walking up from the clicked element's file to the nearest project guide.
 * Pure filesystem behaviour — these tests build a small directory tree in a
 * temp dir and assert which `CLAUDE.md`/`AGENTS.md` is selected, the
 * distance-beats-preference rule, the project-root boundary, and oversize
 * truncation.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type AgentGuide, findNearestAgentGuide, renderAgentGuide } from '../src/agent-guide';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pinagent-guide-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('findNearestAgentGuide', () => {
  it('returns null when the feedback has no file', () => {
    write('CLAUDE.md', '# root');
    expect(findNearestAgentGuide(null, root)).toBeNull();
    expect(findNearestAgentGuide(undefined, root)).toBeNull();
  });

  it('returns null when no guide exists anywhere up to the root', () => {
    write('src/components/Button.tsx', 'export const Button = () => null;');
    expect(findNearestAgentGuide('src/components/Button.tsx', root)).toBeNull();
  });

  it('finds the root guide when nothing is nested', () => {
    write('CLAUDE.md', '# root guide');
    write('src/components/Button.tsx', 'x');
    const guide = findNearestAgentGuide('src/components/Button.tsx', root);
    expect(guide?.relativePath).toBe('CLAUDE.md');
    expect(guide?.filename).toBe('CLAUDE.md');
    expect(guide?.content).toBe('# root guide');
    expect(guide?.truncated).toBe(false);
  });

  it('prefers the nested guide closest to the clicked file', () => {
    write('CLAUDE.md', '# root guide');
    write('src/components/CLAUDE.md', '# components guide');
    write('src/components/Button.tsx', 'x');
    const guide = findNearestAgentGuide('src/components/Button.tsx', root);
    expect(guide?.relativePath).toBe('src/components/CLAUDE.md');
    expect(guide?.content).toBe('# components guide');
  });

  it('finds a guide that sits in the file’s own directory', () => {
    write('src/CLAUDE.md', '# src guide');
    write('src/App.tsx', 'x');
    const guide = findNearestAgentGuide('src/App.tsx', root);
    expect(guide?.relativePath).toBe('src/CLAUDE.md');
  });

  it('accepts AGENTS.md when no CLAUDE.md is present', () => {
    write('AGENTS.md', '# agents guide');
    write('src/App.tsx', 'x');
    const guide = findNearestAgentGuide('src/App.tsx', root);
    expect(guide?.filename).toBe('AGENTS.md');
    expect(guide?.relativePath).toBe('AGENTS.md');
  });

  it('honours the preferred filename when both exist in the same directory', () => {
    write('src/CLAUDE.md', '# claude');
    write('src/AGENTS.md', '# agents');
    write('src/App.tsx', 'x');
    expect(findNearestAgentGuide('src/App.tsx', root)?.filename).toBe('CLAUDE.md');
    expect(findNearestAgentGuide('src/App.tsx', root, { prefer: 'AGENTS.md' })?.filename).toBe(
      'AGENTS.md',
    );
  });

  it('lets distance win over the filename preference', () => {
    // AGENTS.md is nearer (same dir) than the preferred CLAUDE.md one level up.
    write('src/CLAUDE.md', '# claude up');
    write('src/components/AGENTS.md', '# agents near');
    write('src/components/Button.tsx', 'x');
    const guide = findNearestAgentGuide('src/components/Button.tsx', root, { prefer: 'CLAUDE.md' });
    expect(guide?.filename).toBe('AGENTS.md');
    expect(guide?.relativePath).toBe('src/components/AGENTS.md');
  });

  it('stops at the project root and never escapes it', () => {
    // A guide ABOVE the project root must not be picked up.
    const projectRoot = join(root, 'project');
    mkdirSync(join(projectRoot, 'src'), { recursive: true });
    writeFileSync(join(root, 'CLAUDE.md'), '# outside the project');
    writeFileSync(join(projectRoot, 'src', 'App.tsx'), 'x');
    expect(findNearestAgentGuide('src/App.tsx', projectRoot)).toBeNull();
  });

  it('returns null for a file path that escapes the project root', () => {
    write('CLAUDE.md', '# root');
    expect(findNearestAgentGuide('../../etc/passwd', root)).toBeNull();
  });

  it('resolves an absolute file path inside the project', () => {
    write('src/CLAUDE.md', '# src');
    write('src/App.tsx', 'x');
    const guide = findNearestAgentGuide(join(root, 'src/App.tsx'), root);
    expect(guide?.relativePath).toBe('src/CLAUDE.md');
  });

  it('truncates an oversized guide and flags it', () => {
    const big = `${'a'.repeat(50_000)}\nlast line\n`;
    write('CLAUDE.md', big);
    write('App.tsx', 'x');
    const guide = findNearestAgentGuide('App.tsx', root);
    expect(guide?.truncated).toBe(true);
    expect(guide?.content.length).toBeLessThan(big.length);
    expect(guide?.content).toMatch(/\[truncated\]$/);
  });
});

describe('renderAgentGuide', () => {
  const base: AgentGuide = {
    filename: 'CLAUDE.md',
    relativePath: 'src/components/CLAUDE.md',
    content: '# Components\nUse the Button primitive.',
    truncated: false,
  };

  it('wraps the guide in a tagged block citing its path', () => {
    const out = renderAgentGuide(base);
    expect(out).toContain('src/components/CLAUDE.md');
    expect(out).toContain('<project-guidance path="src/components/CLAUDE.md">');
    expect(out).toContain('Use the Button primitive.');
    expect(out).toContain('</project-guidance>');
    expect(out).not.toContain('truncated');
  });

  it('notes truncation when the guide was clipped', () => {
    const out = renderAgentGuide({ ...base, truncated: true });
    expect(out).toContain('truncated');
  });
});
