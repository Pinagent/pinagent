// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalTransport } from '../src/transport/local';

// A run blocked on an open ask_user / permission prompt is reported by the
// list API as `awaitingInput`; the dock must show it as "Needs reply"
// (awaitingClarification), not plain "Working".

function record(over: Record<string, unknown>) {
  return {
    id: 'conv000001',
    comment: 'make it red',
    file: 'src/Foo.tsx',
    line: 1,
    col: 1,
    selector: 'button',
    url: 'http://localhost:5173/',
    status: 'pending',
    worktreeState: 'none',
    branch: null,
    createdAt: '2026-10-08T10:00:00.000Z',
    updatedAt: '2026-10-08T10:00:00.000Z',
    ...over,
  };
}

function serve(rows: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(rows), { status: 200 })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LocalTransport — awaitingInput', () => {
  it('lists a running conversation blocked on a permission prompt as awaitingClarification', async () => {
    serve([
      record({
        isRunning: true,
        awaitingInput: {
          askId: 'ask1',
          kind: 'permission',
          since: '2026-10-08T10:00:00.000Z',
          expiresAt: '2026-10-08T10:05:00.000Z',
        },
      }),
    ]);
    const [c] = await new LocalTransport().listConversations();
    expect(c?.status).toBe('awaitingClarification');
  });

  it('keeps a running conversation with no open ask as working', async () => {
    serve([record({ isRunning: true, awaitingInput: null })]);
    const [c] = await new LocalTransport().listConversations();
    expect(c?.status).toBe('working');
  });

  it('parses an older server that omits the field', async () => {
    serve([record({ isRunning: true })]);
    const [c] = await new LocalTransport().listConversations();
    expect(c?.status).toBe('working');
  });
});
