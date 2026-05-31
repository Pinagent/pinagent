// SPDX-License-Identifier: Apache-2.0
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildInitialPrompt } from '../src/agent';
import { type FeedbackInput, Storage } from '../src/storage';

// 1x1 transparent PNG.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function makeInput(overrides: Partial<FeedbackInput> = {}): FeedbackInput {
  return {
    comment: 'make it red',
    loc: { file: 'src/Foo.tsx', line: 42, col: 7 },
    selector: 'main > div > button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'test-agent',
    screenshot: TINY_PNG_B64,
    createdAt: '2026-05-25T12:00:00.000Z',
    ...overrides,
  };
}

describe('buildInitialPrompt — multi-select additionalAnchors', () => {
  let dir: string;
  let s: Storage;

  beforeEach(async () => {
    dir = join(tmpdir(), `pinagent-prompt-${nanoid()}`);
    await mkdir(dir, { recursive: true });
    s = new Storage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('omits the multi-select block for a single-pick record', async () => {
    const rec = await s.create(nanoid(), makeInput());
    const prompt = buildInitialPrompt(rec, 'inline', dir);
    expect(prompt).toContain('Target: src/Foo.tsx:42:7');
    expect(prompt).not.toContain('multi-selected');
    expect(prompt).not.toMatch(/apply the same change to each/);
  });

  it('enumerates every extra anchor with its file:line:col', async () => {
    const extras = [
      { file: 'src/Bar.tsx', line: 10, col: 2, selector: 'div.bar', clickX: 1, clickY: 2 },
      { file: 'src/Baz.tsx', line: 20, col: 4, selector: 'div.baz', clickX: 3, clickY: 4 },
    ];
    const rec = await s.create(nanoid(), makeInput({ additionalAnchors: extras }));
    const prompt = buildInitialPrompt(rec, 'inline', dir);

    // Primary target still leads.
    expect(prompt).toContain('Target: src/Foo.tsx:42:7');
    // Count reflects primary + extras.
    expect(prompt).toContain('multi-selected 3 elements');
    // Extras enumerated, numbered from #2.
    expect(prompt).toContain('2. src/Bar.tsx:10:2');
    expect(prompt).toContain('3. src/Baz.tsx:20:4');
  });

  it('falls back to the selector when an extra anchor has no source location', async () => {
    const extras = [
      { file: null, line: null, col: null, selector: 'nav > a.cta', clickX: 5, clickY: 6 },
    ];
    const rec = await s.create(nanoid(), makeInput({ additionalAnchors: extras }));
    const prompt = buildInitialPrompt(rec, 'inline', dir);
    expect(prompt).toContain('2. nav > a.cta');
  });
});
