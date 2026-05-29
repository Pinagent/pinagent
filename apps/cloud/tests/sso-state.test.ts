// SPDX-License-Identifier: Elastic-2.0
import { describe, expect, it } from 'vitest';
import { signLoginState, verifyLoginState } from '../src/sso-state';

const SECRET = 'sso-state-secret';

describe('login state', () => {
  it('round-trips connectionId + returnTo', async () => {
    const token = await signLoginState({ connectionId: 'conn-1', returnTo: '/dashboard' }, SECRET, {
      nowSeconds: 1000,
      ttlSeconds: 600,
    });
    const result = await verifyLoginState(token, SECRET, { nowSeconds: 1100 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims).toEqual({
        connectionId: 'conn-1',
        returnTo: '/dashboard',
        iat: 1000,
        exp: 1600,
      });
    }
  });

  it('rejects a forged state (wrong secret)', async () => {
    const token = await signLoginState({ connectionId: 'conn-1', returnTo: '/' }, SECRET);
    expect((await verifyLoginState(token, 'attacker-secret')).ok).toBe(false);
  });

  it('rejects an expired state', async () => {
    const token = await signLoginState({ connectionId: 'conn-1', returnTo: '/' }, SECRET, {
      nowSeconds: 1000,
      ttlSeconds: 60,
    });
    expect((await verifyLoginState(token, SECRET, { nowSeconds: 2000 })).ok).toBe(false);
  });
});
