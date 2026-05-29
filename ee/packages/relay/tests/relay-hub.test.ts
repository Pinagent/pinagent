// SPDX-License-Identifier: Elastic-2.0
import type { RelaySocket } from '@pinagent/ee-relay';
import { RelayHub } from '@pinagent/ee-relay';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/** In-memory RelaySocket that records every frame it's sent. */
class FakeSocket implements RelaySocket {
  readonly sent: unknown[] = [];
  closed: { code?: number; reason?: string } | null = null;
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  close(code?: number, reason?: string): void {
    this.closed = { code, reason };
  }
  /** Frames of a given `type`, for terse assertions. */
  ofType(type: string): Array<Record<string, unknown>> {
    return this.sent.filter((m) => (m as { type?: string }).type === type) as Array<
      Record<string, unknown>
    >;
  }
}

const silentLog = { warn: () => {} };

function event(feedbackId: string) {
  return JSON.stringify({
    type: 'event',
    feedbackId,
    event: { type: 'text', text: 'hi' },
  });
}

describe('RelayHub subscription fan-out', () => {
  let hub: RelayHub;
  let device: FakeSocket;

  beforeEach(() => {
    hub = new RelayHub(silentLog);
    device = new FakeSocket();
    hub.attachDevice(device);
  });

  it('forwards subscribe to the device only on the 0→1 edge', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attachClient(a);
    hub.attachClient(b);

    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    hub.fromClient(b, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));

    // Two clients, one feedback — the agent host should hear about it once.
    expect(device.ofType('subscribe')).toHaveLength(1);
  });

  it('forwards unsubscribe only when the last subscriber leaves', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attachClient(a);
    hub.attachClient(b);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    hub.fromClient(b, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));

    hub.fromClient(a, JSON.stringify({ type: 'unsubscribe', feedbackId: 'fb-aaaa11' }));
    expect(device.ofType('unsubscribe')).toHaveLength(0);

    hub.fromClient(b, JSON.stringify({ type: 'unsubscribe', feedbackId: 'fb-aaaa11' }));
    expect(device.ofType('unsubscribe')).toHaveLength(1);
  });

  it('routes a device event only to clients subscribed to that feedback', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attachClient(a);
    hub.attachClient(b);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    hub.fromClient(b, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-bbbb22' }));

    hub.fromDevice(event('fb-aaaa11'));

    expect(a.ofType('event')).toHaveLength(1);
    expect(b.ofType('event')).toHaveLength(0);
  });

  it('fans a device event out to every subscriber of the same feedback', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attachClient(a);
    hub.attachClient(b);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    hub.fromClient(b, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));

    hub.fromDevice(event('fb-aaaa11'));

    expect(a.ofType('event')).toHaveLength(1);
    expect(b.ofType('event')).toHaveLength(1);
  });

  it('delivers project events only to project subscribers', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attachClient(a);
    hub.attachClient(b);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe_project' }));

    hub.fromDevice(
      JSON.stringify({ type: 'project_event', event: { type: 'conversations_changed' } }),
    );

    expect(a.ofType('project_event')).toHaveLength(1);
    expect(b.ofType('project_event')).toHaveLength(0);
  });

  it('forwards subscribe_project to the device only once across clients', () => {
    const a = new FakeSocket();
    const b = new FakeSocket();
    hub.attachClient(a);
    hub.attachClient(b);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe_project' }));
    hub.fromClient(b, JSON.stringify({ type: 'subscribe_project' }));
    expect(device.ofType('subscribe_project')).toHaveLength(1);
  });

  it('passes actionable client messages straight through to the device', () => {
    const a = new FakeSocket();
    hub.attachClient(a);
    hub.fromClient(
      a,
      JSON.stringify({ type: 'user_message', feedbackId: 'fb-aaaa11', content: 'do the thing' }),
    );
    expect(device.ofType('user_message')).toHaveLength(1);
  });

  it('answers ping locally without touching the device', () => {
    const a = new FakeSocket();
    hub.attachClient(a);
    hub.fromClient(a, JSON.stringify({ type: 'ping' }));
    expect(a.ofType('pong')).toHaveLength(1);
    expect(device.sent).toHaveLength(0);
  });

  it('drops invalid frames from both directions', () => {
    const warn = vi.fn();
    const noisy = new RelayHub({ warn });
    const dev = new FakeSocket();
    const client = new FakeSocket();
    noisy.attachDevice(dev);
    noisy.attachClient(client);

    noisy.fromClient(client, '{ not json');
    noisy.fromClient(client, JSON.stringify({ type: 'bogus' }));
    noisy.fromDevice(JSON.stringify({ type: 'event' /* missing feedbackId */ }));

    expect(dev.sent).toHaveLength(0);
    expect(client.sent).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(3);
  });
});

describe('RelayHub device lifecycle', () => {
  it('errors back to the client when no device is attached', () => {
    const hub = new RelayHub(silentLog);
    const a = new FakeSocket();
    hub.attachClient(a);
    hub.fromClient(
      a,
      JSON.stringify({ type: 'user_message', feedbackId: 'fb-aaaa11', content: 'x' }),
    );
    const errors = a.ofType('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/offline/i);
  });

  it('re-syncs active subscriptions to a freshly attached device', () => {
    const hub = new RelayHub(silentLog);
    const a = new FakeSocket();
    hub.attachClient(a);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    hub.fromClient(a, JSON.stringify({ type: 'subscribe_project' }));

    const device = new FakeSocket();
    hub.attachDevice(device);

    expect(device.ofType('subscribe')).toHaveLength(1);
    expect(device.ofType('subscribe_project')).toHaveLength(1);
  });

  it('supersedes and closes a previous device connection', () => {
    const hub = new RelayHub(silentLog);
    const first = new FakeSocket();
    const second = new FakeSocket();
    hub.attachDevice(first);
    hub.attachDevice(second);
    expect(first.closed).not.toBeNull();
    expect(hub.hasDevice).toBe(true);
  });

  it('releases a client’s subscriptions on detach', () => {
    const hub = new RelayHub(silentLog);
    const device = new FakeSocket();
    hub.attachDevice(device);
    const a = new FakeSocket();
    hub.attachClient(a);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));

    hub.detachClient(a);

    expect(device.ofType('unsubscribe')).toHaveLength(1);
    expect(hub.clientCount).toBe(0);
  });
});

describe('RelayHub hibernation rehydrate', () => {
  it('rebuilds refcounts from restored state without re-forwarding subscribes', () => {
    const hub = new RelayHub(silentLog);
    const device = new FakeSocket();
    hub.restoreDevice(device);

    const a = new FakeSocket();
    hub.restoreClient(a, { feedbackIds: ['fb-aaaa11'], project: true });

    // Restore must not chatter at the device — the connection survived.
    expect(device.sent).toHaveLength(0);

    // Routing works against the rebuilt state.
    hub.fromDevice(event('fb-aaaa11'));
    expect(a.ofType('event')).toHaveLength(1);

    // Refcount is intact: a second subscriber then a single unsubscribe
    // must NOT tear the device subscription down.
    const b = new FakeSocket();
    hub.attachClient(b);
    hub.fromClient(b, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    expect(device.ofType('subscribe')).toHaveLength(0); // already at refcount 1 → no edge
    hub.fromClient(b, JSON.stringify({ type: 'unsubscribe', feedbackId: 'fb-aaaa11' }));
    expect(device.ofType('unsubscribe')).toHaveLength(0); // 'a' still holds it
  });

  it('snapshots a client’s current subscriptions', () => {
    const hub = new RelayHub(silentLog);
    hub.attachDevice(new FakeSocket());
    const a = new FakeSocket();
    hub.attachClient(a);
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    hub.fromClient(a, JSON.stringify({ type: 'subscribe_project' }));

    expect(hub.snapshotClient(a)).toEqual({ feedbackIds: ['fb-aaaa11'], project: true });
  });
});

describe('RelayHub role-based write gating', () => {
  let hub: RelayHub;
  let device: FakeSocket;

  beforeEach(() => {
    hub = new RelayHub(silentLog);
    device = new FakeSocket();
    hub.attachDevice(device);
  });

  const userMessage = JSON.stringify({
    type: 'user_message',
    feedbackId: 'fb-aaaa11',
    content: 'do it',
  });

  it('lets a viewer subscribe (read is open to any member)', () => {
    const a = new FakeSocket();
    hub.attachClient(a, 'viewer');
    hub.fromClient(a, JSON.stringify({ type: 'subscribe', feedbackId: 'fb-aaaa11' }));
    expect(device.ofType('subscribe')).toHaveLength(1);
  });

  it('blocks a viewer from sending a user_message', () => {
    const a = new FakeSocket();
    hub.attachClient(a, 'viewer');
    hub.fromClient(a, userMessage);
    // Not forwarded to the agent host; an error goes back to the client.
    expect(device.ofType('user_message')).toHaveLength(0);
    const errors = a.ofType('error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ feedbackId: 'fb-aaaa11' });
    expect(errors[0]?.message).toMatch(/viewer/);
  });

  it('blocks a viewer from landing a worktree', () => {
    const a = new FakeSocket();
    hub.attachClient(a, 'viewer');
    hub.fromClient(a, JSON.stringify({ type: 'land_request', feedbackId: 'fb-aaaa11' }));
    expect(device.ofType('land_request')).toHaveLength(0);
    expect(a.ofType('error')).toHaveLength(1);
  });

  it.each(['member', 'admin', 'owner'] as const)('lets a %s send a user_message', (role) => {
    const a = new FakeSocket();
    hub.attachClient(a, role);
    hub.fromClient(a, userMessage);
    expect(device.ofType('user_message')).toHaveLength(1);
    expect(a.ofType('error')).toHaveLength(0);
  });

  it('does not gate when no role is present (dev-fallback / no auth)', () => {
    const a = new FakeSocket();
    hub.attachClient(a); // no role
    hub.fromClient(a, userMessage);
    expect(device.ofType('user_message')).toHaveLength(1);
  });

  it('preserves the role across a hibernation snapshot/restore', () => {
    const a = new FakeSocket();
    hub.attachClient(a, 'viewer');
    expect(hub.snapshotClient(a)).toMatchObject({ role: 'viewer' });

    // Simulate a wake: a fresh hub restored from the snapshot still gates.
    const woken = new RelayHub(silentLog);
    woken.attachDevice(new FakeSocket());
    const restored = new FakeSocket();
    woken.restoreClient(restored, { feedbackIds: [], project: false, role: 'viewer' });
    woken.fromClient(restored, userMessage);
    expect(restored.ofType('error')).toHaveLength(1);
  });
});

describe('RelayHub.pushToDevice', () => {
  const policy = JSON.stringify({
    type: 'set_branch_routing',
    defaultBaseBranch: 'main',
    allowedBranchPatterns: ['feat/*'],
  });

  it('forwards a valid control frame to the connected device and reports delivery', () => {
    const hub = new RelayHub(silentLog);
    const device = new FakeSocket();
    hub.attachDevice(device);

    expect(hub.pushToDevice(policy)).toBe(true);
    expect(device.ofType('set_branch_routing')).toHaveLength(1);
    expect(device.ofType('set_branch_routing')[0]).toMatchObject({
      defaultBaseBranch: 'main',
      allowedBranchPatterns: ['feat/*'],
    });
  });

  it('reports not-delivered when no device is connected', () => {
    const hub = new RelayHub(silentLog);
    expect(hub.pushToDevice(policy)).toBe(false);
  });

  it('drops an invalid frame without forwarding (and reports not-delivered)', () => {
    const hub = new RelayHub(silentLog);
    const device = new FakeSocket();
    hub.attachDevice(device);

    expect(hub.pushToDevice(JSON.stringify({ type: 'not-a-real-message' }))).toBe(false);
    expect(hub.pushToDevice('}{ not json')).toBe(false);
    expect(device.sent).toHaveLength(0);
  });
});
