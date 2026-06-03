// SPDX-License-Identifier: Elastic-2.0

import { createInMemoryActiveSessionRegistry } from '@pinagent/ee-relay';
import { describe, expect, it } from 'vitest';

const at = '2026-05-29T00:00:00.000Z';

describe('createInMemoryActiveSessionRegistry', () => {
  it('records connected sessions and lists them by org', async () => {
    const reg = createInMemoryActiveSessionRegistry();
    await reg.recordConnected({ organizationId: 'acme', sessionId: 's1', connectedAt: at });
    await reg.recordConnected({ organizationId: 'acme', sessionId: 's2', connectedAt: at });
    await reg.recordConnected({ organizationId: 'other', sessionId: 's3', connectedAt: at });

    const acme = await reg.listByOrg('acme');
    expect(acme.map((s) => s.sessionId).sort()).toEqual(['s1', 's2']);
    expect(await reg.listByOrg('other')).toHaveLength(1);
    expect(await reg.listByOrg('nobody')).toEqual([]);
  });

  it('is idempotent per session and refreshes connectedAt', async () => {
    const reg = createInMemoryActiveSessionRegistry();
    await reg.recordConnected({ organizationId: 'acme', sessionId: 's1', connectedAt: at });
    await reg.recordConnected({
      organizationId: 'acme',
      sessionId: 's1',
      connectedAt: '2026-05-29T01:00:00.000Z',
    });
    const sessions = await reg.listByOrg('acme');
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.connectedAt).toBe('2026-05-29T01:00:00.000Z');
  });

  it('drops a session on disconnect (and tolerates unknown ones)', async () => {
    const reg = createInMemoryActiveSessionRegistry([
      { organizationId: 'acme', sessionId: 's1', connectedAt: at },
    ]);
    await reg.recordDisconnected('acme', 's1');
    expect(await reg.listByOrg('acme')).toEqual([]);
    // no-op for an untracked session
    await expect(reg.recordDisconnected('acme', 'ghost')).resolves.toBeUndefined();
  });

  it('ignores a stale disconnect for a superseded connection (generation guard)', async () => {
    const reg = createInMemoryActiveSessionRegistry();
    const c1 = '2026-05-29T00:00:00.000Z';
    const c2 = '2026-05-29T00:00:05.000Z';
    // A reconnect: the row now belongs to the NEW connection (connectedAt c2).
    await reg.recordConnected({ organizationId: 'acme', sessionId: 's1', connectedAt: c2 });
    // The OLD connection's disconnect (c1) lands late — must NOT drop the live row.
    await reg.recordDisconnected('acme', 's1', c1);
    expect(await reg.listByOrg('acme')).toHaveLength(1);
    // The matching disconnect (c2) does drop it.
    await reg.recordDisconnected('acme', 's1', c2);
    expect(await reg.listByOrg('acme')).toEqual([]);
  });
});
