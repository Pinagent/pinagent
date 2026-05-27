// SPDX-License-Identifier: Apache-2.0
/**
 * `applyConversationPatch` — wraps Storage.patch with audit emission for
 * rename + archive transitions. Pins the round-trip behavior + the
 * audit log entries each transition produces.
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

// Each test gets its own project root so the process-wide DB cache
// (keyed by root) doesn't bleed audit rows between tests.
const PARENT = join(tmpdir(), `pa-patch-${nanoid(8)}`);

async function freshRoot(): Promise<string> {
  const root = join(PARENT, nanoid(8));
  await mkdir(root, { recursive: true });
  return root;
}

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

async function seed(root: string): Promise<string> {
  const id = nanoid(10);
  const storage = new storageMod.Storage(root);
  await storage.create(id, {
    comment: 'tighten the hero copy',
    loc: { file: 'src/Hero.tsx', line: 4, col: 2 },
    selector: 'h1',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot: TINY_PNG,
    createdAt: new Date().toISOString(),
  });
  return id;
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

describe('applyConversationPatch — title', () => {
  it('writes a title override and emits conversation_renamed', async () => {
    const root = await freshRoot();
    const id = await seed(root);

    const { record } = await patchMod.applyConversationPatch(root, id, { title: 'Pricing copy' });
    expect(record?.title).toBe('Pricing copy');

    const events = await audit.listAuditEvents(root, { conversationId: id });
    const rename = events.find((e) => e.action === 'conversation_renamed');
    expect(rename).toBeDefined();
    expect(rename?.payload).toEqual({ from: null, to: 'Pricing copy' });
  });

  it('clears title back to null on empty string + emits the rename', async () => {
    const root = await freshRoot();
    const id = await seed(root);
    await patchMod.applyConversationPatch(root, id, { title: 'set first' });
    const { record } = await patchMod.applyConversationPatch(root, id, { title: '' });
    expect(record?.title).toBeNull();

    const events = await audit.listAuditEvents(root, { conversationId: id });
    const renames = events.filter((e) => e.action === 'conversation_renamed');
    expect(renames).toHaveLength(2);
    expect(renames[0]?.payload).toEqual({ from: 'set first', to: null });
  });

  it('skips the audit event when the title does not actually change', async () => {
    const root = await freshRoot();
    const id = await seed(root);
    await patchMod.applyConversationPatch(root, id, { title: 'same' });
    await patchMod.applyConversationPatch(root, id, { title: 'same' });

    const events = await audit.listAuditEvents(root, { conversationId: id });
    const renames = events.filter((e) => e.action === 'conversation_renamed');
    // First call writes from null → 'same'; second is a no-op.
    expect(renames).toHaveLength(1);
  });

  it('trims whitespace on the title before storing', async () => {
    const root = await freshRoot();
    const id = await seed(root);
    const { record } = await patchMod.applyConversationPatch(root, id, {
      title: '  spaced out  ',
    });
    expect(record?.title).toBe('spaced out');
  });
});

describe('applyConversationPatch — archive', () => {
  it('flips archived and emits conversation_archived', async () => {
    const root = await freshRoot();
    const id = await seed(root);
    const { record } = await patchMod.applyConversationPatch(root, id, { archived: true });
    expect(record?.archived).toBe(true);

    const events = await audit.listAuditEvents(root, { conversationId: id });
    expect(events.some((e) => e.action === 'conversation_archived')).toBe(true);
  });

  it('emits conversation_unarchived on the reverse transition', async () => {
    const root = await freshRoot();
    const id = await seed(root);
    await patchMod.applyConversationPatch(root, id, { archived: true });
    const { record } = await patchMod.applyConversationPatch(root, id, { archived: false });
    expect(record?.archived).toBe(false);

    const events = await audit.listAuditEvents(root, { conversationId: id });
    expect(events.some((e) => e.action === 'conversation_archived')).toBe(true);
    expect(events.some((e) => e.action === 'conversation_unarchived')).toBe(true);
  });

  it('skips the audit event when archived is unchanged', async () => {
    const root = await freshRoot();
    const id = await seed(root);
    await patchMod.applyConversationPatch(root, id, { archived: false }); // already false
    const events = await audit.listAuditEvents(root, { conversationId: id });
    expect(events.some((e) => e.action.startsWith('conversation_archive'))).toBe(false);
  });
});

describe('applyConversationPatch — not found', () => {
  it('returns null record when the id does not exist', async () => {
    const root = await freshRoot();
    const result = await patchMod.applyConversationPatch(root, 'nonexistent_x', { title: 'x' });
    expect(result.record).toBeNull();
  });
});
