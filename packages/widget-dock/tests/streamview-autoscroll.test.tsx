// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Regression: StreamView pins the conversation transcript to the
 * bottom when new items arrive. The original implementation set
 * `scrollTop = scrollHeight` on the inner row wrapper — which isn't a
 * scrollable element — so the panel never followed live updates. The
 * fix calls `scrollIntoView({ block: 'end' })` on the last row instead,
 * letting the browser walk up to whichever ancestor actually scrolls.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationStream, StreamItem } from '../src/hooks/useConversationStream';
import { StreamView } from '../src/routes/ConversationStream';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_ASKED: ReadonlySet<string> = new Set();

function streamWith(items: StreamItem[]): ConversationStream {
  return { items, worktree: null };
}

function errorItem(id: number, receivedAt: string): StreamItem {
  return { kind: 'error', id, message: `err-${id}`, receivedAt };
}

function renderStream(root: Root, items: StreamItem[]): void {
  act(() => {
    root.render(
      <StreamView
        stream={streamWith(items)}
        isMock={false}
        optimistic={[]}
        answeredAskIds={NO_ASKED}
        onAnswerAsk={() => {}}
        askDisabled
      />,
    );
  });
}

describe('StreamView auto-scroll', () => {
  let container: HTMLDivElement;
  let root: Root;
  let scrollSpy: ReturnType<typeof vi.fn>;
  let originalScrollIntoView: PropertyDescriptor | undefined;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    scrollSpy = vi.fn();
    originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    Object.defineProperty(Element.prototype, 'scrollIntoView', {
      value: scrollSpy,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, 'scrollIntoView', originalScrollIntoView);
    } else {
      // @ts-expect-error – removing the patched method we added
      delete Element.prototype.scrollIntoView;
    }
  });

  it('scrolls the last row into view when items are present on mount', () => {
    renderStream(root, [
      errorItem(1, '2026-01-01T00:00:01Z'),
      errorItem(2, '2026-01-01T00:00:02Z'),
    ]);
    expect(scrollSpy).toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: 'end' });
  });

  it('scrolls again when a new item arrives during streaming', () => {
    const initial = [errorItem(1, '2026-01-01T00:00:01Z'), errorItem(2, '2026-01-01T00:00:02Z')];
    renderStream(root, initial);
    const callsAfterInitial = scrollSpy.mock.calls.length;

    renderStream(root, [...initial, errorItem(3, '2026-01-01T00:00:03Z')]);
    expect(scrollSpy.mock.calls.length).toBeGreaterThan(callsAfterInitial);
    expect(scrollSpy).toHaveBeenLastCalledWith({ block: 'end' });
  });

  it('does not scroll when the stream is empty', () => {
    renderStream(root, []);
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
