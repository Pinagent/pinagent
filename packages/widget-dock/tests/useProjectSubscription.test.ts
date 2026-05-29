// SPDX-License-Identifier: Apache-2.0
/**
 * Pin which query keys get invalidated when the dev-server fans out a
 * `conversations_changed` project event. The hook itself is a thin
 * effect that wires this listener into the transport; the listener
 * factory carries the logic worth pinning.
 *
 * Regression: `['conversation']` (singular, per-id detail) was missing
 * from the invalidation set, which left the conversation-detail panel's
 * status timeline pills stuck on the initial status through the agent's
 * working → landed transitions. The worktree-state pill at the bottom
 * still updated (it rides a separate per-conversation subscription),
 * which masked the bug in casual testing.
 */
import { describe, expect, it, vi } from 'vitest';
import { createProjectEventListener } from '../src/hooks/useProjectSubscription';

function makeFakeQueryClient() {
  const invalidateQueries = vi.fn().mockResolvedValue(undefined);
  return { invalidateQueries };
}

describe('createProjectEventListener', () => {
  it('invalidates the conversation-list query on conversations_changed', () => {
    const queryClient = makeFakeQueryClient();
    const listen = createProjectEventListener(queryClient);
    listen({ type: 'conversations_changed' });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversations'] });
  });

  it('invalidates the conversation-detail query on conversations_changed', () => {
    // The bug this test pins: without invalidating ['conversation']
    // (singular), the status timeline pills in the detail panel never
    // refetch and stay stuck on the initial status.
    const queryClient = makeFakeQueryClient();
    const listen = createProjectEventListener(queryClient);
    listen({ type: 'conversations_changed' });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['conversation'] });
  });

  it('invalidates the changes / branches / pullRequests / auditLog queries', () => {
    const queryClient = makeFakeQueryClient();
    const listen = createProjectEventListener(queryClient);
    listen({ type: 'conversations_changed' });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['changes'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['branches'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['pullRequests'] });
    expect(queryClient.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['auditLog'] });
  });

  it('invalidates only the worktree-server list on worktree_servers_changed', () => {
    const queryClient = makeFakeQueryClient();
    const listen = createProjectEventListener(queryClient);
    listen({ type: 'worktree_servers_changed' });
    const calls = queryClient.invalidateQueries.mock.calls.map((args) => args[0].queryKey);
    expect(calls).toEqual([['worktreeServers']]);
  });

  it('invalidates exactly the documented set (no more, no less)', () => {
    // Belt-and-suspenders: catches both accidental drops AND accidental
    // additions, so the documented "what does conversations_changed
    // touch?" contract stays accurate.
    const queryClient = makeFakeQueryClient();
    const listen = createProjectEventListener(queryClient);
    listen({ type: 'conversations_changed' });
    const calls = queryClient.invalidateQueries.mock.calls.map((args) => args[0].queryKey);
    expect(calls).toEqual([
      ['conversations'],
      ['conversation'],
      ['changes'],
      ['branches'],
      ['pullRequests'],
      ['auditLog'],
    ]);
  });
});
