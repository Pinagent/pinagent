// SPDX-License-Identifier: Apache-2.0
/**
 * Verify-on-set credential checks. The GitHub path is mocked at the
 * Octokit boundary; the Anthropic path stubs global `fetch`. The contract
 * is "translate an upstream success/failure into {ok, login?/error?}
 * without throwing".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Hoisted so the (hoisted) vi.mock factory can close over it.
const mocks = vi.hoisted(() => ({ getAuthenticated: vi.fn() }));

vi.mock('@octokit/rest', () => ({
  Octokit: class {
    users = { getAuthenticated: mocks.getAuthenticated };
  },
}));

const getAuthenticated = mocks.getAuthenticated;

import { validateAnthropicKey, validateGithubToken } from '../src/connection-validators';

describe('validateGithubToken', () => {
  beforeEach(() => {
    getAuthenticated.mockReset();
  });

  it('returns ok + login when the token authenticates', async () => {
    getAuthenticated.mockResolvedValue({ data: { login: 'octocat' } });
    expect(await validateGithubToken('ghp_good')).toEqual({ ok: true, login: 'octocat' });
  });

  it('returns the error message when Octokit rejects', async () => {
    getAuthenticated.mockRejectedValue(new Error('Bad credentials'));
    expect(await validateGithubToken('ghp_bad')).toEqual({ ok: false, error: 'Bad credentials' });
  });

  it('falls back to a generic message for a non-Error rejection', async () => {
    getAuthenticated.mockRejectedValue('nope');
    const res = await validateGithubToken('ghp_bad');
    expect(res.ok).toBe(false);
    expect(res.error).toBe('GitHub rejected the token');
  });
});

describe('validateAnthropicKey', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:true on a 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    expect(await validateAnthropicKey('sk-ant-good')).toEqual({ ok: true });
  });

  it('surfaces the upstream error message from a JSON error body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'invalid x-api-key' } }),
      }),
    );
    expect(await validateAnthropicKey('sk-ant-bad')).toEqual({
      ok: false,
      error: 'invalid x-api-key',
    });
  });

  it('falls back to the status code when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json');
        },
      }),
    );
    expect(await validateAnthropicKey('sk-ant-bad')).toEqual({
      ok: false,
      error: 'Anthropic API returned 500',
    });
  });

  it('returns ok:false with the thrown message when fetch itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    expect(await validateAnthropicKey('sk-ant-x')).toEqual({ ok: false, error: 'network down' });
  });
});
