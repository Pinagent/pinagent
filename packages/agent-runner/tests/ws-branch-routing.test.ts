// SPDX-License-Identifier: Apache-2.0
/**
 * WS round-trip for the cloud→relay→dev-server policy push: a
 * `set_branch_routing` frame (forwarded from the control plane over the relay
 * channel) lands in the agent-runner's local project settings, where
 * `worktree.ts` enforces it. Real WS server + real `ws` client; the handler is
 * fire-and-forget (no reply), so we poll the settings file for the effect.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

const TEST_PORT = 53702;
let WS_URL: string;

const SINGLETON_KEY = Symbol.for('pinagent.ws-server');

const ROOT = join(tmpdir(), `pa-wsbr-${nanoid(8)}`);

type ServerMod = typeof import('../src/ws-server');
type SettingsMod = typeof import('../src/settings-store');

let server: ServerMod;
let settingsMod: SettingsMod;

beforeAll(async () => {
  process.env.PINAGENT_WS_PORT = String(TEST_PORT);
  process.env.PINAGENT_PROJECT_ROOT = ROOT;
  process.env.PINAGENT_WORKTREE_TTL_DAYS = '0'; // disable startup sweep
  process.env.NODE_ENV = 'production';
  (globalThis as Record<symbol, unknown>)[SINGLETON_KEY] = undefined;

  await mkdir(ROOT, { recursive: true });
  server = await import('../src/ws-server');
  settingsMod = await import('../src/settings-store');

  const handle = await server.startWsServer();
  WS_URL = `ws://127.0.0.1:${handle.port}/__pinagent/ws`;
});

afterAll(async () => {
  const handle = (globalThis as Record<symbol, { wss?: { close: () => void } }>)[SINGLETON_KEY];
  handle?.wss?.close();
  (globalThis as Record<symbol, unknown>)[SINGLETON_KEY] = undefined;
  await rm(ROOT, { recursive: true, force: true });
});

async function connected(): Promise<WebSocket> {
  const ws = new WebSocket(WS_URL);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  return ws;
}

/** Poll settings until `predicate` holds (the push handler sends no reply). */
async function waitForSettings(
  predicate: (
    s: Awaited<ReturnType<InstanceType<SettingsMod['SettingsStore']>['read']>>,
  ) => boolean,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = await new settingsMod.SettingsStore(ROOT).read();
    if (predicate(s)) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('settings did not reach the expected state in time');
}

describe('set_branch_routing over WS', () => {
  it('applies allowedBranchPatterns and the base branch', async () => {
    const ws = await connected();
    ws.send(
      JSON.stringify({
        type: 'set_branch_routing',
        defaultBaseBranch: 'develop',
        allowedBranchPatterns: ['feat/*', 'fix/*'],
      }),
    );

    await waitForSettings(
      (s) =>
        s.baseBranch === 'develop' &&
        s.allowedBranchPatterns.length === 2 &&
        s.allowedBranchPatterns.includes('feat/*'),
    );
    ws.close();
  });

  it('leaves the base branch unchanged when defaultBaseBranch is null', async () => {
    // Pin a known base branch first.
    await new settingsMod.SettingsStore(ROOT).patch({ baseBranch: 'release' });

    const ws = await connected();
    ws.send(
      JSON.stringify({
        type: 'set_branch_routing',
        defaultBaseBranch: null,
        allowedBranchPatterns: ['only/*'],
      }),
    );

    await waitForSettings(
      (s) => s.allowedBranchPatterns.length === 1 && s.allowedBranchPatterns[0] === 'only/*',
    );
    // base branch was not touched by the null push
    expect((await new settingsMod.SettingsStore(ROOT).read()).baseBranch).toBe('release');
    ws.close();
  });

  it('keeps the connection alive and prior settings when a pushed policy is invalid', async () => {
    await new settingsMod.SettingsStore(ROOT).patch({
      baseBranch: 'main',
      allowedBranchPatterns: ['keep/*'],
    });

    const ws = await connected();
    // The wire schema only length-bounds defaultBaseBranch, so this frame
    // parses — but the branch name has spaces, which SettingsStore's stricter
    // BRANCH_RE rejects. That exercises the handler's try/catch: the patch
    // throws, is swallowed, and the connection survives.
    ws.send(
      JSON.stringify({
        type: 'set_branch_routing',
        defaultBaseBranch: 'bad branch name',
        allowedBranchPatterns: ['new/*'],
      }),
    );

    // Connection stays open; a follow-up ping still gets a pong.
    const pong = await new Promise<unknown>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no pong')), 1500);
      ws.on('message', (raw: Buffer) => {
        const m = JSON.parse(raw.toString('utf8'));
        if (m.type === 'pong') {
          clearTimeout(t);
          resolve(m);
        }
      });
      ws.send(JSON.stringify({ type: 'ping' }));
    });
    expect(pong).toEqual({ type: 'pong' });

    // The invalid patch was rejected wholesale — prior settings intact.
    const s = await new settingsMod.SettingsStore(ROOT).read();
    expect(s.baseBranch).toBe('main');
    expect(s.allowedBranchPatterns).toEqual(['keep/*']);
    ws.close();
  });
});
