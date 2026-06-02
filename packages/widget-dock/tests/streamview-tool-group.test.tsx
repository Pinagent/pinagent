// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Tool calls are collapsed into a quiet, opt-in group so the transcript
 * reads like a chat with the agent rather than a stream of machine
 * activity. Consecutive `tool_use` / `tool_result` events render as a
 * single `N tool calls` line; the individual rows stay hidden until the
 * user taps to expand. Prose between tool runs splits the groups so
 * chronological order is preserved.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConversationStream, StreamItem } from '../src/hooks/useConversationStream';
import { StreamView } from '../src/routes/ConversationStream';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_ASKED: ReadonlySet<string> = new Set();

let nextId = 0;
function toolUse(name: string, summary: string): StreamItem {
  return {
    kind: 'event',
    id: ++nextId,
    receivedAt: `2026-01-01T00:00:0${nextId}Z`,
    event: { type: 'tool_use', name, summary },
  };
}
function toolResult(ok: boolean): StreamItem {
  return {
    kind: 'event',
    id: ++nextId,
    receivedAt: `2026-01-01T00:00:0${nextId}Z`,
    event: { type: 'tool_result', ok },
  };
}
function text(t: string): StreamItem {
  return {
    kind: 'event',
    id: ++nextId,
    receivedAt: `2026-01-01T00:00:0${nextId}Z`,
    event: { type: 'text', text: t },
  };
}

function renderStream(root: Root, items: StreamItem[]): void {
  act(() => {
    root.render(
      <StreamView
        stream={{ items, worktree: null } as ConversationStream}
        isMock={false}
        optimistic={[]}
        answeredAskIds={NO_ASKED}
        onAnswerAsk={() => {}}
        askDisabled
      />,
    );
  });
}

describe('StreamView tool-call grouping', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    nextId = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('collapses consecutive tool calls into one opt-in line, hidden by default', () => {
    renderStream(root, [
      toolUse('Read', 'src/App.tsx'),
      toolResult(true),
      toolUse('Edit', 'src/App.tsx'),
      toolResult(true),
    ]);
    // Two tool_use calls → "2 tool calls"; the tool detail (file names)
    // stays hidden until the user opts in.
    expect(container.textContent).toContain('2 tool calls');
    expect(container.textContent).not.toContain('src/App.tsx');
  });

  it('reveals the individual tool rows when the group is tapped', () => {
    renderStream(root, [toolUse('Read', 'src/App.tsx'), toolResult(true)]);
    const toggle = container.querySelector('button');
    expect(toggle).not.toBeNull();
    act(() => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.textContent).toContain('src/App.tsx');
  });

  it('keeps prose out of the tool group, splitting runs around it', () => {
    renderStream(root, [
      text('Looking at the file.'),
      toolUse('Read', 'a.ts'),
      toolResult(true),
      text('Now editing.'),
      toolUse('Edit', 'a.ts'),
      toolResult(true),
    ]);
    // Prose renders directly; two separate single-call groups flank it.
    expect(container.textContent).toContain('Looking at the file.');
    expect(container.textContent).toContain('Now editing.');
    const groupLabels = container.textContent?.match(/1 tool call(?!s)/g) ?? [];
    expect(groupLabels.length).toBe(2);
  });
});
