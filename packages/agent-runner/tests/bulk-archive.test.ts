// SPDX-License-Identifier: Apache-2.0
/**
 * `applyBulkArchive` — multi-row archive flip with a single bulk audit
 * event. Pins the round-trip + the updated/skipped split + the audit
 * emission shape.
 */
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type StorageMod = typeof import('../src/storage');
type AuditMod = typeof import('../src/audit-log');
type PatchMod = typeof import('../src/conversation-patch');

let storageMod: StorageMod;
let audit: AuditMod;
let patchMod: PatchMod;

const PARENT = join(tmpdir(), `pa-bulk-${nanoid(8)}`);

async function freshRoot(): Promise<string> {
  const root = join(PARENT, nanoid(8));
  await mkdir(root, { recursive: true });
  return root;
}

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function seed(root: string, n: number): Promise<string[]> {
  const ids: string[] = [];
  const storage = new storageMod.Storage(root);
  for (let i = 0; i < n; i++) {
    const id = nanoid(10);
    await storage.create(id, {
      comment: `conversation ${i}`,
      loc: null,
      selector: 'h1',
      url: 'http://localhost:3000/',
      viewport: { w: 1280, h: 720 },
      userAgent: 'vitest',
      screenshot: TINY_PNG,
      createdAt: new Date().toISOString(),
    });
    ids.push(id);
  }
  return ids;
}

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  await mkdir(PARENT, { recursive: true });
  storageMod = await import('../src/storage');
  audit = await import('../src/audit-log');
  patchMod = await import('../src/conversation-patch');
});

afterAll(async () => {
  await rm(PARENT, { recursive: true, force: true });
});

describe('applyBulkArchive — archive', () => {
  it('flips archived on N rows and emits one bulk audit event', async () => {
    const root = await freshRoot();
    const ids = await seed(root, 5);

    const result = await patchMod.applyBulkArchive(root, ids, true);
    expect(result.updated.sort()).toEqual([...ids].sort());
    expect(result.skipped).toEqual([]);

    const storage = new storageMod.Storage(root);
    for (const id of ids) {
      const rec = await storage.read(id);
      expect(rec?.archived).toBe(true);
    }

    const events = await audit.listAuditEvents(root);
    const bulk = events.filter((e) => e.action === 'conversations_bulk_archived');
    expect(bulk).toHaveLength(1);
    expect(bulk[0]?.payload).toMatchObject({ count: 5 });
    expect((bulk[0]?.payload as { ids: string[] }).ids.sort()).toEqual([...ids].sort());
  });

  it('skips rows that are already archived', async () => {
    const root = await freshRoot();
    const [a, b, c] = await seed(root, 3);
    if (!a || !b || !c) throw new Error('seed broken');
    // Pre-archive b out-of-band; bulk archive on all three should
    // archive a + c, skip b.
    await patchMod.applyConversationPatch(root, b, { archived: true });

    const result = await patchMod.applyBulkArchive(root, [a, b, c], true);
    expect(result.updated.sort()).toEqual([a, c].sort());
    expect(result.skipped).toEqual([b]);

    // Bulk audit event names only the updated ids.
    const events = await audit.listAuditEvents(root);
    const bulk = events.find((e) => e.action === 'conversations_bulk_archived');
    expect((bulk?.payload as { ids: string[] }).ids.sort()).toEqual([a, c].sort());
    expect((bulk?.payload as { count: number }).count).toBe(2);
  });

  it('skips unknown ids without throwing', async () => {
    const root = await freshRoot();
    const [a] = await seed(root, 1);
    if (!a) throw new Error('seed broken');
    const result = await patchMod.applyBulkArchive(root, [a, 'nonexistent_x'], true);
    expect(result.updated).toEqual([a]);
    expect(result.skipped).toEqual(['nonexistent_x']);
  });

  it('emits no audit event when nothing actually changed', async () => {
    const root = await freshRoot();
    // Empty ids → nothing to update, nothing to skip, no audit.
    const result = await patchMod.applyBulkArchive(root, [], true);
    expect(result.updated).toEqual([]);
    expect(result.skipped).toEqual([]);
    const events = await audit.listAuditEvents(root);
    expect(events.filter((e) => e.action.startsWith('conversations_bulk'))).toEqual([]);
  });

  it('also emits no audit when every id is a skip', async () => {
    const root = await freshRoot();
    const [a, b] = await seed(root, 2);
    if (!a || !b) throw new Error('seed broken');
    // Both already at archived=false; bulk-archive=false is a no-op.
    const result = await patchMod.applyBulkArchive(root, [a, b], false);
    expect(result.updated).toEqual([]);
    expect(result.skipped.sort()).toEqual([a, b].sort());
    const events = await audit.listAuditEvents(root);
    expect(events.filter((e) => e.action.startsWith('conversations_bulk'))).toEqual([]);
  });
});

describe('applyBulkArchive — unarchive', () => {
  it('flips a batch of archived rows back and emits the unarchive event', async () => {
    const root = await freshRoot();
    const ids = await seed(root, 3);
    await patchMod.applyBulkArchive(root, ids, true);

    const result = await patchMod.applyBulkArchive(root, ids, false);
    expect(result.updated.sort()).toEqual([...ids].sort());

    const storage = new storageMod.Storage(root);
    for (const id of ids) {
      const rec = await storage.read(id);
      expect(rec?.archived).toBe(false);
    }

    const events = await audit.listAuditEvents(root);
    const unarchive = events.find((e) => e.action === 'conversations_bulk_unarchived');
    expect(unarchive).toBeDefined();
    expect((unarchive?.payload as { count: number }).count).toBe(3);
  });
});
