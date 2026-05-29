// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * The transcript `result` row shows the SDK's `total_cost_usd`. For
 * OAuth/Claude-subscription runs that figure is notional (billed against
 * the subscription quota, not a card), so StreamView must relabel it as
 * `subscription` rather than a plain `$` — matching the list/detail
 * CostChip and the in-page widget footer. For API-key runs (apiKeySource
 * null/other) the dollar amount stands.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ConversationStream, StreamItem } from '../src/hooks/useConversationStream';
import { StreamView } from '../src/routes/Conversations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NO_ASKED: ReadonlySet<string> = new Set();

function resultItem(): StreamItem {
  return {
    kind: 'event',
    id: 1,
    receivedAt: '2026-01-01T00:00:01Z',
    event: {
      type: 'result',
      subtype: 'success',
      numTurns: 2,
      totalCostUsd: 0.0473,
      durationMs: 1200,
    },
  };
}

function render(root: Root, apiKeySource?: string | null): void {
  act(() => {
    root.render(
      <StreamView
        stream={{ items: [resultItem()], worktree: null } satisfies ConversationStream}
        isMock={false}
        optimistic={[]}
        answeredAskIds={NO_ASKED}
        onAnswerAsk={() => {}}
        askDisabled
        apiKeySource={apiKeySource}
      />,
    );
  });
}

describe('StreamView result-row cost label', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('relabels notional cost as subscription for an oauth run', () => {
    render(root, 'oauth');
    expect(container.textContent).toContain('subscription');
    expect(container.textContent).toContain('API-equivalent');
    // The raw "$0.0473 ·"-style billed figure should not stand alone.
    expect(container.textContent).not.toMatch(/·\s*\$0\.0473\s*$/);
  });

  it('shows the dollar amount for an API-key run (apiKeySource null)', () => {
    render(root, null);
    expect(container.textContent).toContain('$0.0473');
    expect(container.textContent).not.toContain('subscription');
  });

  it('labels cost as "not tracked" for a BYO-CLI run', () => {
    render(root, 'cli');
    expect(container.textContent).toContain('cost not tracked');
    expect(container.textContent).not.toContain('$');
  });
});
