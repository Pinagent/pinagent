// SPDX-License-Identifier: Apache-2.0
/**
 * Audit-log: record + list round-trips, filtering, and that
 * `Storage.create` emits the `conversation_created` event.
 *
 * Lifecycle emits (conversation_landed / conversation_discarded /
 * pr_created) are covered indirectly by the existing agent-merge tests
 * — this file exercises the audit module's own surface.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type AuditMod = typeof import('../src/audit-log');
type StorageMod = typeof import('../src/storage');

let audit: AuditMod;
let storageMod: StorageMod;

// One parent dir for cleanup; each test grabs a unique subdir so the
// process-wide DB cache (keyed by project root) doesn't bleed state
// between tests.
const PARENT = join(tmpdir(), `pa-audit-${nanoid(8)}`);
const ROOTS: string[] = [];

async function freshRoot(): Promise<string> {
  const root = join(PARENT, nanoid(8));
  await mkdir(root, { recursive: true });
  ROOTS.push(root);
  return root;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  await mkdir(PARENT, { recursive: true });
  audit = await import('../src/audit-log');
  storageMod = await import('../src/storage');
});

afterAll(async () => {
  await rm(PARENT, { recursive: true, force: true });
});

describe('recordAuditEvent + listAuditEvents', () => {
  it('round-trips a single event', async () => {
    const root = await freshRoot();
    await audit.recordAuditEvent(root, {
      conversationId: 'conv-1',
      actor: 'user',
      action: 'conversation_landed',
      payload: { branch: 'pinagent/foo', target: 'main' },
    });
    const events = await audit.listAuditEvents(root);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: 'conv-1',
      actor: 'user',
      action: 'conversation_landed',
      payload: { branch: 'pinagent/foo', target: 'main' },
    });
    expect(events[0]?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns newest first', async () => {
    const root = await freshRoot();
    await audit.recordAuditEvent(root, { actor: 'user', action: 'a' });
    await new Promise((r) => setTimeout(r, 5));
    await audit.recordAuditEvent(root, { actor: 'user', action: 'b' });
    await new Promise((r) => setTimeout(r, 5));
    await audit.recordAuditEvent(root, { actor: 'user', action: 'c' });
    const events = await audit.listAuditEvents(root);
    expect(events.map((e) => e.action)).toEqual(['c', 'b', 'a']);
  });

  it('filters by conversationId', async () => {
    const root = await freshRoot();
    await audit.recordAuditEvent(root, {
      conversationId: 'a',
      actor: 'user',
      action: 'conversation_created',
    });
    await audit.recordAuditEvent(root, {
      conversationId: 'b',
      actor: 'user',
      action: 'conversation_created',
    });
    await audit.recordAuditEvent(root, {
      conversationId: 'a',
      actor: 'user',
      action: 'conversation_landed',
    });
    const onlyA = await audit.listAuditEvents(root, { conversationId: 'a' });
    expect(onlyA).toHaveLength(2);
    expect(onlyA.every((e) => e.conversationId === 'a')).toBe(true);
  });

  it('honors limit + offset for pagination', async () => {
    const root = await freshRoot();
    for (let i = 0; i < 5; i++) {
      await audit.recordAuditEvent(root, { actor: 'user', action: `action-${i}` });
      await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await audit.listAuditEvents(root, { limit: 2 });
    const page2 = await audit.listAuditEvents(root, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]?.action).toBe('action-4');
    expect(page2[0]?.action).toBe('action-2');
  });
});

describe('Storage.create emit site', () => {
  it('records a conversation_created event when a feedback is opened', async () => {
    const root = await freshRoot();
    const storage = new storageMod.Storage(root);
    const id = nanoid(10);
    await storage.create(id, {
      comment: 'tweak the header',
      loc: { file: 'src/Header.tsx', line: 4, col: 2 },
      selector: 'h1',
      url: 'http://localhost:3000/about',
      viewport: { w: 1280, h: 720 },
      userAgent: 'vitest',
      screenshot:
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
      createdAt: new Date().toISOString(),
    });
    const events = await audit.listAuditEvents(root, { conversationId: id });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      conversationId: id,
      actor: 'user',
      action: 'conversation_created',
    });
    expect(events[0]?.payload).toMatchObject({
      page: 'http://localhost:3000/about',
      file: 'src/Header.tsx',
    });
  });
});
