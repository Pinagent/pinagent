// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the URL-construction + anchor-parsing pieces of the VSCode bridge.
 * The fire-the-URI side (anchor.click()) is DOM-coupled and not covered
 * here — those paths are validated by the manual smoke test.
 */
import { describe, expect, it } from 'vitest';
import {
  buildClaudeCommand,
  buildOpenClaudeUri,
  buildOpenFileUri,
  parseAnchorLoc,
} from '../src/lib/vscode-bridge';

describe('parseAnchorLoc', () => {
  it('parses a plain "path:line:col" anchor', () => {
    expect(parseAnchorLoc('src/Hero.tsx:42:8')).toEqual({
      path: 'src/Hero.tsx',
      line: 42,
      col: 8,
    });
  });

  it('preserves colons inside the path', () => {
    // Windows-style drive letters and nested paths that happen to
    // contain colons should split only the trailing two.
    expect(parseAnchorLoc('C:/work/app/src/Hero.tsx:42:8')).toEqual({
      path: 'C:/work/app/src/Hero.tsx',
      line: 42,
      col: 8,
    });
  });

  it('returns null for inputs without a numeric line + col tail', () => {
    expect(parseAnchorLoc('src/Hero.tsx')).toBeNull();
    expect(parseAnchorLoc('src/Hero.tsx:42')).toBeNull();
    expect(parseAnchorLoc('')).toBeNull();
  });

  it('returns null when the tail isn’t numeric', () => {
    expect(parseAnchorLoc('src/Hero.tsx:not:numbers')).toBeNull();
  });
});

describe('buildOpenFileUri', () => {
  it('encodes path/line/col into the vscode:// query', () => {
    const uri = buildOpenFileUri('src/Hero.tsx', 42, 8);
    expect(uri).toBe(
      'vscode://pinagent.pinagent-vscode/open-file?path=src%2FHero.tsx&line=42&col=8',
    );
  });

  it('escapes characters that would break a query string', () => {
    const uri = buildOpenFileUri('src/with space & amp.tsx', 1, 1);
    // URLSearchParams encodes `&` as `%26` and spaces as `+`.
    expect(uri).toContain('path=src%2Fwith+space+%26+amp.tsx');
  });
});

describe('buildClaudeCommand', () => {
  it('wraps the prompt in a single-quoted here-doc so shell metacharacters survive', () => {
    const cmd = buildClaudeCommand('hello "world" $(rm -rf /)');
    expect(cmd).toBe(
      `claude -p "$(cat <<'PINAGENT_EOF'\nhello "world" $(rm -rf /)\nPINAGENT_EOF\n)"`,
    );
  });

  it('preserves newlines in the prompt verbatim', () => {
    const cmd = buildClaudeCommand('line one\nline two\nline three');
    expect(cmd).toContain('line one\nline two\nline three');
    // The here-doc terminator must be on its own line — otherwise bash
    // doesn't recognize it and the prompt swallows everything after.
    expect(cmd).toMatch(/\nPINAGENT_EOF\n\)"$/);
  });

  it('handles an empty prompt without producing malformed shell', () => {
    const cmd = buildClaudeCommand('');
    expect(cmd).toBe(`claude -p "$(cat <<'PINAGENT_EOF'\n\nPINAGENT_EOF\n)"`);
  });
});

describe('buildOpenClaudeUri', () => {
  it('base64url-encodes the prompt so it survives the URL trip', () => {
    const uri = buildOpenClaudeUri('hello\nworld');
    expect(uri).toMatch(/^vscode:\/\/pinagent\.pinagent-vscode\/open-claude\?prompt=[\w-]+$/);
    // No `=` padding, no `+`/`/` (base64url, not standard base64).
    const tail = uri.split('?prompt=')[1] ?? '';
    expect(tail.includes('+')).toBe(false);
    expect(tail.includes('/')).toBe(false);
    expect(tail.endsWith('=')).toBe(false);
  });

  it('round-trips non-ASCII content', () => {
    const uri = buildOpenClaudeUri('café — 🚀');
    const tail = uri.split('?prompt=')[1] ?? '';
    // Decode by reversing the base64url massage we apply in encoding.
    const padded = tail.replace(/-/g, '+').replace(/_/g, '/');
    const fullyPadded = padded + '='.repeat((4 - (padded.length % 4)) % 4);
    const decoded = new TextDecoder().decode(
      Uint8Array.from(atob(fullyPadded), (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe('café — 🚀');
  });
});
