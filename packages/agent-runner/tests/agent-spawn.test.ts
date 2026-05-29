// SPDX-License-Identifier: Apache-2.0
import { mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { nanoid } from 'nanoid';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from 'vitest';

/**
 * Fake-SDK integration tests for the agent spawn / follow-up / interrupt loop.
 *
 * We stub `@anthropic-ai/claude-agent-sdk` so `query()` returns a
 * scripted AsyncIterable of SDKMessages instead of actually talking to
 * Claude. Everything else — agent.ts itself, the event bus, the log
 * writer, the Storage class, Drizzle migrations — runs for real.
 *
 * What this proves:
 *   - SDK messages are translated to AgentEvents and published to the bus
 *   - The markdown log file gets the init footer, transcript, and result block
 *   - session_id is persisted to Storage for follow-up resumption
 *   - runFollowUpTurn picks up the persisted session and starts another query
 *   - interruptRun aborts the in-flight controller
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const actual = await vi.importActual<typeof import('@anthropic-ai/claude-agent-sdk')>(
    '@anthropic-ai/claude-agent-sdk',
  );
  return {
    ...actual,
    query: vi.fn(),
  };
});

// Late imports so the mock is in place before agent.ts pulls the SDK in.
type AgentMod = typeof import('../src/agent');
type BusMod = typeof import('../src/bus');
type StorageMod = typeof import('../src/storage');
type SdkMod = typeof import('@anthropic-ai/claude-agent-sdk');

let agent: AgentMod;
let bus: BusMod;
let storageMod: StorageMod;
let sdk: SdkMod;

const PROJECT_ROOT = join(tmpdir(), `pa-agent-${nanoid(8)}`);

beforeAll(async () => {
  process.env.PINAGENT_PROJECT_ROOT = PROJECT_ROOT;
  process.env.PINAGENT_SPAWN_AGENT = 'inline';
  process.env.NODE_ENV = 'production'; // belt-and-suspenders against WS bootstrap
  await mkdir(PROJECT_ROOT, { recursive: true });
  agent = await import('../src/agent');
  bus = await import('../src/bus');
  storageMod = await import('../src/storage');
  sdk = await import('@anthropic-ai/claude-agent-sdk');
});

afterAll(async () => {
  await rm(PROJECT_ROOT, { recursive: true, force: true });
});

beforeEach(() => {
  (sdk.query as Mock).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------- helpers ----------

interface ScriptedRun {
  messages: SDKMessage[];
  /** Inspect what `query()` was called with. */
  capturedParams?: Parameters<typeof sdk.query>[0];
}

/**
 * Make `query()` return an async iterator over scripted messages.
 * Captures the params it was called with so tests can inspect
 * resume / cwd / etc.
 */
function scriptQuery(messages: SDKMessage[]): ScriptedRun {
  const run: ScriptedRun = { messages };
  (sdk.query as Mock).mockImplementation((params: unknown) => {
    run.capturedParams = params as Parameters<typeof sdk.query>[0];
    return (async function* () {
      for (const m of messages) yield m;
    })();
  });
  return run;
}

/**
 * Make `query()` hang until aborted. Used for interrupt tests.
 */
function scriptHangingQuery(): { aborted: Promise<void> } {
  let resolveAborted!: () => void;
  const aborted = new Promise<void>((r) => {
    resolveAborted = r;
  });
  (sdk.query as Mock).mockImplementation((params: unknown) => {
    const signal = (params as { options?: { abortController?: AbortController } }).options
      ?.abortController?.signal;
    return (async function* () {
      // Yield an init so the run has time to register in activeRuns.
      yield {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-hang',
        model: 'claude',
        permissionMode: 'acceptEdits',
        mcp_servers: [],
        apiKeySource: 'oauth',
      } as never;

      await new Promise<void>((_resolve, reject) => {
        if (signal?.aborted) {
          resolveAborted();
          reject(new Error('aborted'));
          return;
        }
        signal?.addEventListener('abort', () => {
          resolveAborted();
          reject(new Error('aborted'));
        });
      });
    })();
  });
  return { aborted };
}

async function makeFeedback(commentOverride = 'make it red'): Promise<{
  id: string;
  storage: InstanceType<StorageMod['Storage']>;
}> {
  const id = nanoid(10);
  const storage = new storageMod.Storage(PROJECT_ROOT);
  await storage.create(id, {
    comment: commentOverride,
    loc: { file: 'src/Foo.tsx', line: 1, col: 1 },
    selector: 'button',
    url: 'http://localhost:3000/',
    viewport: { w: 1280, h: 720 },
    userAgent: 'vitest',
    screenshot:
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    createdAt: new Date().toISOString(),
  });
  return { id, storage };
}

/** Collect bus events until a predicate fires (or a timeout elapses). */
async function collectUntil(
  feedbackId: string,
  predicate: (e: import('@pinagent/shared').AgentEvent) => boolean,
  timeoutMs = 1500,
): Promise<import('@pinagent/shared').AgentEvent[]> {
  const collected: import('@pinagent/shared').AgentEvent[] = [];
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`collectUntil timed out (got ${collected.length} events)`)),
      timeoutMs,
    );
    bus.getOrCreateBus(feedbackId).subscribe({
      onEvent(e) {
        collected.push(e);
        if (predicate(e)) {
          clearTimeout(t);
          resolve(collected);
        }
      },
      onClose() {},
    });
  });
}

/**
 * Wait for the run for `feedbackId` to fully finish (activeRuns
 * entry deleted). Needed because spawnAgent fire-and-forgets the
 * SDK consume loop — a bus 'result' event fires BEFORE consumeStream
 * writes the resolution block and clears activeRuns.
 */
async function waitForRunIdle(feedbackId: string, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await agent.hasActiveRun(feedbackId))) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`run for ${feedbackId} did not idle in time`);
}

// ---------- tests ----------

describe('spawnAgent', () => {
  it('translates SDK messages into AgentEvents and writes the log file', async () => {
    const { id, storage } = await makeFeedback();
    const rec = await storage.read(id);
    expect(rec).not.toBeNull();

    scriptQuery([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        model: 'claude-opus',
        permissionMode: 'acceptEdits',
        mcp_servers: [{ name: 'pinagent', status: 'connected' }],
        apiKeySource: 'oauth',
      } as never,
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'Looking at the button…' }] },
      } as never,
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', name: 'Edit', input: { file_path: 'src/Foo.tsx' } }],
        },
      } as never,
      {
        type: 'user',
        message: { content: [{ type: 'tool_result', is_error: false }] },
      } as never,
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 100, output_tokens: 50 },
        total_cost_usd: 0.01,
        duration_ms: 1500,
      } as never,
    ]);

    const eventsP = collectUntil(id, (e) => e.type === 'result');
    await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
    const events = await eventsP;
    // consumeStream's resolution write happens AFTER the 'result' event
    // publishes. Wait for activeRuns to clear before asserting on the file.
    await waitForRunIdle(id);

    // init → text → progress → tool_use → progress → tool_result → result.
    // A `progress` event follows each assistant message (one model turn),
    // carrying the running turn count.
    expect(events.map((e) => e.type)).toEqual([
      'init',
      'text',
      'progress',
      'tool_use',
      'progress',
      'tool_result',
      'result',
    ]);

    // The progress events tick the live turn counter up across the run.
    expect(events.filter((e) => e.type === 'progress').map((e) => e.turn)).toEqual([1, 2]);

    // Init carries through the session/model/permission/apiKeySource fields.
    expect(events[0]).toMatchObject({
      type: 'init',
      sessionId: 'sess-1',
      model: 'claude-opus',
      permissionMode: 'acceptEdits',
      apiKeySource: 'oauth',
    });

    // Log file landed.
    const log = await readFile(join(PROJECT_ROOT, '.pinagent', 'logs', `${id}.md`), 'utf8');
    expect(log).toContain('# Pinagent feedback');
    expect(log).toContain('sess-1'); // init footer
    expect(log).toContain('Looking at the button'); // assistant text
    expect(log).toContain('[Edit]'); // tool chip
    expect(log).toContain('## Resolution'); // resolution block

    // Session id persisted to Storage for future follow-up turns.
    const after = await storage.read(id);
    expect(after?.agentSessionId).toBe('sess-1');
  });

  it('passes ask_user MCP server + system-prompt appendix to query()', async () => {
    const { id, storage } = await makeFeedback();
    const rec = await storage.read(id);
    const captured = scriptQuery([
      {
        type: 'result',
        subtype: 'success',
        num_turns: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
        total_cost_usd: 0,
        duration_ms: 0,
      } as never,
    ]);

    const done = collectUntil(id, (e) => e.type === 'result');
    await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
    await done;
    await waitForRunIdle(id);

    expect(captured.capturedParams).toBeDefined();
    const opts = captured.capturedParams?.options;
    expect(opts).toBeDefined();
    expect(opts?.mcpServers).toHaveProperty('pinagent-ask-user');
    expect(opts?.allowedTools).toContain('mcp__pinagent-ask-user__ask_user');
    expect(opts?.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    // PINAGENT_PROJECT_ROOT is pinned in the SDK env so the MCP server
    // running in the worktree resolves storage back to the real root.
    expect(opts?.env?.PINAGENT_PROJECT_ROOT).toBe(PROJECT_ROOT);
  });

  it('emits an error event when the SDK iterator throws', async () => {
    const { id, storage } = await makeFeedback();
    const rec = await storage.read(id);

    (sdk.query as Mock).mockImplementation(() =>
      (async function* () {
        throw new Error('SDK exploded');
        // biome-ignore lint/correctness/noUnreachable: scripted
        yield {} as never;
      })(),
    );

    const events: import('@pinagent/shared').AgentEvent[] = [];
    bus.getOrCreateBus(id).subscribe({
      onEvent(e) {
        events.push(e);
      },
      onClose() {},
    });

    await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
    // Wait long enough for the SqliteEventBus poll loop (100ms) to deliver
    // the error event written by the consumeStream finally block.
    await new Promise((r) => setTimeout(r, 250));

    const errorEvent = events.find((e) => e.type === 'error');
    expect(errorEvent).toBeDefined();
    expect((errorEvent as { message: string }).message).toMatch(/SDK exploded/);
  });

  it('mode=false is a no-op (no query call, no log file)', async () => {
    const { id, storage } = await makeFeedback();
    const rec = await storage.read(id);

    await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: false });

    expect((sdk.query as Mock).mock.calls).toHaveLength(0);
    // No log file was written for this id.
    await expect(
      readFile(join(PROJECT_ROOT, '.pinagent', 'logs', `${id}.md`), 'utf8'),
    ).rejects.toThrow();
  });

  describe('permissionMode plumbing (settings → SDK)', () => {
    // Each test mutates the shared SettingsStore + env var; restore both
    // afterwards so later tests run against the unset/default baseline.
    let store: InstanceType<typeof import('../src/settings-store').SettingsStore>;
    let priorEnv: string | undefined;
    let restoreSettings: (() => Promise<void>) | null = null;

    beforeEach(async () => {
      const settingsMod = await import('../src/settings-store');
      store = new settingsMod.SettingsStore(PROJECT_ROOT);
      priorEnv = process.env.PINAGENT_AGENT_PERMISSION_MODE;
      delete process.env.PINAGENT_AGENT_PERMISSION_MODE;
    });

    afterEach(async () => {
      if (priorEnv === undefined) delete process.env.PINAGENT_AGENT_PERMISSION_MODE;
      else process.env.PINAGENT_AGENT_PERMISSION_MODE = priorEnv;
      if (restoreSettings) {
        await restoreSettings();
        restoreSettings = null;
      }
    });

    it.each([
      ['auto', 'acceptEdits'],
      ['approve', 'default'],
      ['dry-run', 'plan'],
    ] as const)('persists settings.permissionMode=%s and the SDK call sees %s', async (saved, expected) => {
      await store.patch({ permissionMode: saved });
      restoreSettings = () => store.patch({ permissionMode: 'auto' }).then(() => undefined);

      const { id, storage } = await makeFeedback();
      const rec = await storage.read(id);
      const captured = scriptQuery([
        {
          type: 'result',
          subtype: 'success',
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          total_cost_usd: 0,
          duration_ms: 0,
        } as never,
      ]);

      const done = collectUntil(id, (e) => e.type === 'result');
      await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
      await done;
      await waitForRunIdle(id);

      expect(captured.capturedParams?.options?.permissionMode).toBe(expected);
    });

    it('env override wins over the saved setting', async () => {
      // Setting says "approve" (→ default), but the env explicitly
      // overrides with "bypassPermissions" — env should win.
      await store.patch({ permissionMode: 'approve' });
      restoreSettings = () => store.patch({ permissionMode: 'auto' }).then(() => undefined);
      process.env.PINAGENT_AGENT_PERMISSION_MODE = 'bypassPermissions';

      const { id, storage } = await makeFeedback();
      const rec = await storage.read(id);
      const captured = scriptQuery([
        {
          type: 'result',
          subtype: 'success',
          num_turns: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          total_cost_usd: 0,
          duration_ms: 0,
        } as never,
      ]);

      const done = collectUntil(id, (e) => e.type === 'result');
      await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
      await done;
      await waitForRunIdle(id);

      expect(captured.capturedParams?.options?.permissionMode).toBe('bypassPermissions');
    });
  });
});

describe('runFollowUpTurn', () => {
  it('rejects when there is no prior agent session', async () => {
    const { id } = await makeFeedback('first comment');
    await expect(agent.runFollowUpTurn(id, 'follow up')).rejects.toThrow(/no prior agent session/);
  });

  it('rejects when the feedback does not exist', async () => {
    await expect(agent.runFollowUpTurn('aBcDeFgHiJ', 'hi')).rejects.toThrow(/feedback not found/);
  });

  it('resumes the prior SDK session and processes the follow-up turn', async () => {
    const { id, storage } = await makeFeedback();
    const rec = await storage.read(id);

    // First turn: an init that gives us a session id, then a result.
    scriptQuery([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-follow',
        model: 'claude',
        permissionMode: 'acceptEdits',
        mcp_servers: [],
        apiKeySource: 'oauth',
      } as never,
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
        duration_ms: 1,
      } as never,
    ]);
    const firstDone = collectUntil(id, (e) => e.type === 'result');
    await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
    await firstDone;
    // Critical: wait for the first run to actually finish before
    // launching the follow-up, or runFollowUpTurn rejects with
    // "a turn is already in progress".
    await waitForRunIdle(id);

    // Confirm the session id was persisted.
    const afterFirst = await storage.read(id);
    expect(afterFirst?.agentSessionId).toBe('sess-follow');

    // Second turn: script another result; capture the params so we can
    // assert `resume: sess-follow` was passed.
    const second = scriptQuery([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'follow-up reply' }] },
      } as never,
      {
        type: 'result',
        subtype: 'success',
        num_turns: 2,
        usage: { input_tokens: 5, output_tokens: 5 },
        total_cost_usd: 0,
        duration_ms: 1,
      } as never,
    ]);

    // Wait for the SECOND result. A fresh subscriber replays the
    // conversation from the start (the bus polls `messages` from id 0),
    // so it sees the first run's persisted result before the follow-up's.
    // Resolve only once both have arrived, guaranteeing the follow-up
    // `query()` has actually been invoked before we assert on its params.
    let resultsSeen = 0;
    const secondDone = new Promise<void>((resolve) => {
      bus.getOrCreateBus(id).subscribe({
        onEvent(e) {
          if (e.type === 'result') {
            resultsSeen += 1;
            if (resultsSeen >= 2) resolve();
          }
        },
        onClose() {},
      });
    });

    await agent.runFollowUpTurn(id, 'and make it bold');
    await secondDone;

    expect(second.capturedParams).toBeDefined();
    expect(second.capturedParams?.options?.resume).toBe('sess-follow');
    // The follow-up prompt is the user message itself, not the
    // boilerplate Pinagent workflow prompt.
    expect(second.capturedParams?.prompt).toBe('and make it bold');
    expect(resultsSeen).toBeGreaterThanOrEqual(1);
  });

  /**
   * Regression for the lifecycle Re-open added in #91. The follow-up
   * loop must survive a round trip through a terminal state:
   *
   *   agent finishes  → MCP resolve_feedback inline-promotes to landed
   *   user clicks Re-open → reopenConversation flips back to pending/none
   *   user sends a message → runFollowUpTurn resumes the SAME SDK session
   *
   * The dock's textarea is gated on `stream.done`, which is only set
   * when the bus closes via `FINISHED_ROLE`. Re-open must NOT close the
   * bus and must NOT clear `agentSessionId`, or the follow-up here
   * would fail at the "no prior agent session" check.
   */
  it('supports a follow-up turn after the conversation has been reopened', async () => {
    const { id, storage } = await makeFeedback('original comment');
    const rec = await storage.read(id);

    // Initial run: produces a session id we'll need to resume from later.
    scriptQuery([
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-reopen',
        model: 'claude',
        permissionMode: 'acceptEdits',
        mcp_servers: [],
        apiKeySource: 'oauth',
      } as never,
      {
        type: 'result',
        subtype: 'success',
        num_turns: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
        duration_ms: 1,
      } as never,
    ]);
    const initialDone = collectUntil(id, (e) => e.type === 'result');
    await agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });
    await initialDone;
    await waitForRunIdle(id);

    // Simulate the post-resolve_feedback inline-mode terminal state
    // (status=fixed, worktreeState=landed). This is what the MCP
    // auto-promotion in PR #89 leaves behind, and what Re-open is
    // built to reverse.
    await storage.patch(id, { status: 'fixed', worktreeState: 'landed' });

    // Re-open: the conversation moves back to the active list.
    const logPath = join(PROJECT_ROOT, '.pinagent', 'logs', `${id}.md`);
    const reopen = await agent.reopenConversation(PROJECT_ROOT, id, logPath);
    expect(reopen.ok).toBe(true);

    // Re-open must reset lifecycle metadata but preserve the SDK
    // session id — otherwise the follow-up below has nothing to resume.
    const afterReopen = await storage.read(id);
    expect(afterReopen?.worktreeState).toBe('none');
    expect(afterReopen?.status).toBe('pending');
    expect(afterReopen?.agentSessionId).toBe('sess-reopen');

    // Follow-up turn: should resume the original SDK session.
    const second = scriptQuery([
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'actually we need it bolder' }] },
      } as never,
      {
        type: 'result',
        subtype: 'success',
        num_turns: 2,
        usage: { input_tokens: 5, output_tokens: 5 },
        total_cost_usd: 0,
        duration_ms: 1,
      } as never,
    ]);

    // As above: a fresh subscriber replays the initial run's result, so
    // wait for the second (the follow-up's) before asserting on params.
    let resultsSeen = 0;
    const followUpDone = new Promise<void>((resolve) => {
      bus.getOrCreateBus(id).subscribe({
        onEvent(e) {
          if (e.type === 'result') {
            resultsSeen += 1;
            if (resultsSeen >= 2) resolve();
          }
        },
        onClose() {},
      });
    });

    await agent.runFollowUpTurn(id, 'still not bold enough');
    await followUpDone;

    expect(second.capturedParams?.options?.resume).toBe('sess-reopen');
    expect(second.capturedParams?.prompt).toBe('still not bold enough');
    expect(resultsSeen).toBeGreaterThanOrEqual(1);
  });
});

describe('interruptRun', () => {
  it('returns false when no run is in flight', async () => {
    expect(await agent.interruptRun(`unknown-${Date.now()}`)).toBe(false);
  });

  it('aborts the in-flight controller and returns true', async () => {
    const { id, storage } = await makeFeedback();
    const rec = await storage.read(id);

    const { aborted } = scriptHangingQuery();

    // Kick off the run (won't resolve until we abort).
    void agent.spawnAgent({ projectRoot: PROJECT_ROOT, feedback: rec!, mode: 'inline' });

    // Wait for the run to actually be registered in activeRuns. The
    // init event is what signals "we're past the SDK call and
    // iterating", which is when activeRuns has the entry.
    await collectUntil(id, (e) => e.type === 'init');

    const interrupted = await agent.interruptRun(id);
    expect(interrupted).toBe(true);
    await expect(aborted).resolves.toBeUndefined();
  });
});
