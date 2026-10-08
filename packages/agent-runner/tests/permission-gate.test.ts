// SPDX-License-Identifier: Apache-2.0
import type { AgentEvent } from '@pinagent/shared';
import { nanoid } from 'nanoid';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Capture what the gate publishes instead of writing to SQLite. The gate
// talks to the developer only through bus events + `resolveAsk`, so this
// is the whole surface.
const published: Array<{ feedbackId: string; event: AgentEvent }> = [];
vi.mock('../src/bus', () => ({
  getOrCreateBus: (feedbackId: string) => ({
    publish: async (event: AgentEvent) => {
      published.push({ feedbackId, event });
    },
  }),
}));

const { rejectAsk, resolveAsk } = await import('../src/ask-user');
const { ALLOW_FOR_RUN, ALLOW_ONCE, DENY, DRY_RUN_DENIED_TOOLS, createPermissionGate } =
  await import('../src/permission-gate');

type Gate = NonNullable<ReturnType<typeof createPermissionGate>>;
type Ctx = Parameters<Gate>[2];

function ctx(overrides: Partial<Ctx> = {}): Ctx {
  return { signal: new AbortController().signal, toolUseID: 't', ...overrides };
}

function gateFor(permissionMode: string, ttlMs = 5_000): { gate: Gate; feedbackId: string } {
  const feedbackId = nanoid(10);
  const gate = createPermissionGate({ feedbackId, permissionMode, ttlMs });
  if (!gate) throw new Error(`no gate for ${permissionMode}`);
  return { gate, feedbackId };
}

function eventsFor(feedbackId: string): AgentEvent[] {
  return published.filter((p) => p.feedbackId === feedbackId).map((p) => p.event);
}

/** Wait until `n` ask_user events are published for this feedback. */
async function asksFor(feedbackId: string, n = 1) {
  await vi.waitFor(() => {
    expect(eventsFor(feedbackId).filter((e) => e.type === 'ask_user')).toHaveLength(n);
  });
  return eventsFor(feedbackId).filter(
    (e): e is Extract<AgentEvent, { type: 'ask_user' }> => e.type === 'ask_user',
  );
}

const READ_RULE = {
  type: 'addRules' as const,
  rules: [{ toolName: 'Read', ruleContent: '//elsewhere/**' }],
  behavior: 'allow' as const,
  destination: 'localSettings' as const,
};

beforeEach(() => {
  published.length = 0;
});

describe('createPermissionGate', () => {
  it('installs no gate for modes that never prompt', () => {
    expect(createPermissionGate({ feedbackId: 'x', permissionMode: 'bypassPermissions' })).toBe(
      undefined,
    );
    expect(createPermissionGate({ feedbackId: 'x', permissionMode: 'dontAsk' })).toBe(undefined);
    for (const mode of ['acceptEdits', 'default', 'plan']) {
      expect(createPermissionGate({ feedbackId: 'x', permissionMode: mode })).toBeTypeOf(
        'function',
      );
    }
  });

  it('asks the developer and allows the call on "Allow"', async () => {
    const { gate, feedbackId } = gateFor('acceptEdits');
    const input = { command: 'cat ../shared/README.md' };
    const result = gate('Bash', input, ctx({ decisionReason: 'Path is outside the project' }));

    const [ask] = await asksFor(feedbackId);
    expect(ask).toMatchObject({
      kind: 'permission',
      question: 'Allow Bash `cat ../shared/README.md`?',
      context: 'Path is outside the project',
      options: [ALLOW_ONCE, DENY],
    });
    resolveAsk(ask!.askId, ALLOW_ONCE);
    expect(await result).toEqual({ behavior: 'allow', updatedInput: input });
  });

  it('"Allow for this run" returns the suggestions scoped to the session only', async () => {
    const { gate, feedbackId } = gateFor('acceptEdits');
    const input = { file_path: '/elsewhere/a.ts' };
    const result = gate('Read', input, ctx({ suggestions: [READ_RULE] }));

    const [ask] = await asksFor(feedbackId);
    expect(ask!.options).toEqual([ALLOW_ONCE, ALLOW_FOR_RUN, DENY]);
    resolveAsk(ask!.askId, ALLOW_FOR_RUN);
    expect(await result).toEqual({
      behavior: 'allow',
      updatedInput: input,
      // Never the suggested `localSettings`: the run must not write the
      // developer's settings files.
      updatedPermissions: [{ ...READ_RULE, destination: 'session' }],
    });
  });

  it('denies on "Deny" and passes a typed reply through to the agent', async () => {
    const { gate, feedbackId } = gateFor('default');
    const denied = gate('WebFetch', { url: 'https://example.com' }, ctx());
    const [first] = await asksFor(feedbackId);
    resolveAsk(first!.askId, DENY);
    const res = await denied;
    expect(res.behavior).toBe('deny');
    expect(res.behavior === 'deny' && res.message).toContain('denied');

    const replied = gate('WebFetch', { url: 'https://example.com' }, ctx());
    const [, second] = await asksFor(feedbackId, 2);
    resolveAsk(second!.askId, 'use the local copy in docs/ instead');
    const res2 = await replied;
    expect(res2.behavior).toBe('deny');
    expect(res2.behavior === 'deny' && res2.message).toContain(
      'use the local copy in docs/ instead',
    );
  });

  it('denies and retires the prompt when nobody answers in time', async () => {
    const { gate, feedbackId } = gateFor('acceptEdits', 30);
    const res = await gate('Bash', { command: 'make' }, ctx());
    expect(res.behavior).toBe('deny');
    expect(res.behavior === 'deny' && res.message).toMatch(/no answer within/);
    const [ask] = await asksFor(feedbackId);
    expect(eventsFor(feedbackId)).toContainEqual({
      type: 'ask_expired',
      askId: ask!.askId,
      reason: expect.stringMatching(/no answer within/),
    });
  });

  it('denies and retires the prompt when the run is stopped mid-wait', async () => {
    const { gate, feedbackId } = gateFor('acceptEdits');
    const stop = new AbortController();
    const result = gate('Bash', { command: 'make' }, ctx({ signal: stop.signal }));
    const [ask] = await asksFor(feedbackId);
    stop.abort();
    const res = await result;
    expect(res.behavior).toBe('deny');
    expect(eventsFor(feedbackId)).toContainEqual(
      expect.objectContaining({ type: 'ask_expired', askId: ask!.askId }),
    );
    // A late answer to the retired prompt is a harmless no-op.
    expect(() => resolveAsk(ask!.askId, ALLOW_ONCE)).not.toThrow();
  });

  it('denies an already-stopped run without bothering the developer', async () => {
    const { gate, feedbackId } = gateFor('acceptEdits');
    const stop = new AbortController();
    stop.abort();
    const res = await gate('Bash', { command: 'make' }, ctx({ signal: stop.signal }));
    expect(res.behavior).toBe('deny');
    expect(eventsFor(feedbackId)).toEqual([]);
  });

  it('shows one prompt at a time and closes queued ones when the run ends', async () => {
    const { gate, feedbackId } = gateFor('acceptEdits');
    const a = gate('Read', { file_path: '/a' }, ctx());
    const b = gate('Read', { file_path: '/b' }, ctx());
    const c = gate('Read', { file_path: '/c' }, ctx());

    // Only the first is visible until it's answered.
    const [askA] = await asksFor(feedbackId);
    resolveAsk(askA!.askId, ALLOW_ONCE);
    expect((await a).behavior).toBe('allow');
    const [, askB] = await asksFor(feedbackId, 2);
    expect(askB!.question).toContain('/b');

    rejectAsk(feedbackId, 'agent run ended');
    expect((await b).behavior).toBe('deny');
    expect((await c).behavior).toBe('deny');
    // `c` was never shown, so only `b` gets an ask_expired.
    const expired = eventsFor(feedbackId).filter((e) => e.type === 'ask_expired');
    expect(expired).toEqual([
      { type: 'ask_expired', askId: askB!.askId, reason: 'agent run ended' },
    ]);
    expect(eventsFor(feedbackId).filter((e) => e.type === 'ask_user')).toHaveLength(2);
  });

  it("redirects the SDK's AskUserQuestion to Pinagent's ask_user", async () => {
    const { gate, feedbackId } = gateFor('acceptEdits');
    const res = await gate('AskUserQuestion', { questions: [] }, ctx());
    expect(res.behavior).toBe('deny');
    expect(res.behavior === 'deny' && res.message).toContain('mcp__pinagent-ask-user__ask_user');
    expect(eventsFor(feedbackId)).toEqual([]);
  });

  describe('dry-run (plan)', () => {
    it('hard-denies every mutating / plan-exiting tool without prompting', async () => {
      const { gate, feedbackId } = gateFor('plan');
      for (const tool of DRY_RUN_DENIED_TOOLS) {
        const res = await gate(tool, {}, ctx());
        expect(res.behavior, `${tool} should be denied in dry-run`).toBe('deny');
      }
      expect(eventsFor(feedbackId)).toEqual([]);
    });

    it('never lets "Allow for this run" switch mode or allow a denied tool', async () => {
      const { gate, feedbackId } = gateFor('plan');
      const input = { file_path: '/elsewhere/a.ts' };
      const result = gate(
        'Read',
        input,
        ctx({
          suggestions: [
            READ_RULE,
            { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
            {
              type: 'addRules',
              rules: [{ toolName: 'Edit' }],
              behavior: 'allow',
              destination: 'session',
            },
            { type: 'addDirectories', directories: ['/elsewhere'], destination: 'localSettings' },
          ],
        }),
      );
      const [ask] = await asksFor(feedbackId);
      resolveAsk(ask!.askId, ALLOW_FOR_RUN);
      expect(await result).toEqual({
        behavior: 'allow',
        updatedInput: input,
        updatedPermissions: [
          { ...READ_RULE, destination: 'session' },
          { type: 'addDirectories', directories: ['/elsewhere'], destination: 'session' },
        ],
      });
    });
  });
});
