// SPDX-License-Identifier: Apache-2.0
import type { AgentEvent } from '@pinagent/shared';
import { describe, expect, it } from 'vitest';
import { CliAgentProvider } from '../src/providers/cli';
import { ClaudeCodeProvider, createProvider, resolveProviderId } from '../src/providers/index';
import type { AgentRunRequest } from '../src/providers/types';

/** Drain a provider run into the flat list of events it emitted. */
async function collect(provider: CliAgentProvider, req: AgentRunRequest): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const item of provider.run(req)) {
    for (const e of item.events ?? []) events.push(e);
  }
  return events;
}

function makeRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    projectRoot: process.cwd(),
    feedbackId: 'feedback-1',
    cwd: process.cwd(),
    prompt: 'do the thing',
    isInitial: true,
    permissionMode: 'acceptEdits',
    abortSignal: new AbortController().signal,
    ...overrides,
  };
}

describe('resolveProviderId', () => {
  it('defaults to claude-code when unset', () => {
    expect(resolveProviderId({})).toBe('claude-code');
  });

  it('maps cli and is case/space insensitive', () => {
    expect(resolveProviderId({ PINAGENT_AGENT_PROVIDER: 'cli' })).toBe('cli');
    expect(resolveProviderId({ PINAGENT_AGENT_PROVIDER: ' CLI ' })).toBe('cli');
  });

  it('falls back to claude-code for unrecognised values', () => {
    expect(resolveProviderId({ PINAGENT_AGENT_PROVIDER: 'gpt' })).toBe('claude-code');
  });

  it('createProvider returns the matching instance', () => {
    expect(createProvider('cli')).toBeInstanceOf(CliAgentProvider);
    expect(createProvider('claude-code')).toBeInstanceOf(ClaudeCodeProvider);
  });
});

describe('CliAgentProvider', () => {
  it('throws a clear error when no command is configured', async () => {
    const prior = process.env.PINAGENT_AGENT_CLI_COMMAND;
    process.env.PINAGENT_AGENT_CLI_COMMAND = '';
    try {
      const provider = new CliAgentProvider();
      await expect(collect(provider, makeRequest())).rejects.toThrow(
        /PINAGENT_AGENT_CLI_COMMAND is required/,
      );
    } finally {
      if (prior === undefined) delete process.env.PINAGENT_AGENT_CLI_COMMAND;
      else process.env.PINAGENT_AGENT_CLI_COMMAND = prior;
    }
  });

  it('streams stdout lines as text and emits init + result (text mode)', async () => {
    const prior = { ...process.env };
    // Print two lines to stdout, exit 0.
    process.env.PINAGENT_AGENT_CLI_COMMAND = JSON.stringify([
      process.execPath,
      '-e',
      'console.log("looking at the button"); console.log("done")',
    ]);
    delete process.env.PINAGENT_AGENT_CLI_FORMAT;
    delete process.env.PINAGENT_AGENT_CLI_PROMPT;
    try {
      const events = await collect(new CliAgentProvider(), makeRequest());
      const init = events.find((e) => e.type === 'init');
      expect(init).toBeDefined();
      expect((init as Extract<AgentEvent, { type: 'init' }>).apiKeySource).toBe('cli');

      const texts = events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { text: string }).text);
      expect(texts).toContain('looking at the button');
      expect(texts).toContain('done');

      const result = events.find((e) => e.type === 'result') as Extract<
        AgentEvent,
        { type: 'result' }
      >;
      expect(result).toBeDefined();
      expect(result.subtype).toBe('success');
      expect(result.totalCostUsd).toBe(0);
    } finally {
      process.env = prior;
    }
  });

  it('maps stream-json lines to text and tool_use events', async () => {
    const prior = { ...process.env };
    const lines = [
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hello' }] },
      }),
      JSON.stringify({ type: 'tool_use', name: 'Edit', input: { file_path: 'src/App.tsx' } }),
      'not json at all',
    ];
    const script = lines.map((l) => `console.log(${JSON.stringify(l)})`).join(';');
    process.env.PINAGENT_AGENT_CLI_COMMAND = JSON.stringify([process.execPath, '-e', script]);
    process.env.PINAGENT_AGENT_CLI_FORMAT = 'stream-json';
    try {
      const events = await collect(new CliAgentProvider(), makeRequest());
      expect(events.some((e) => e.type === 'text' && e.text === 'hello')).toBe(true);
      expect(
        events.some(
          (e) => e.type === 'tool_use' && e.name === 'Edit' && e.summary.includes('App.tsx'),
        ),
      ).toBe(true);
      // Unparseable lines fall back to raw text rather than being dropped.
      expect(events.some((e) => e.type === 'text' && e.text === 'not json at all')).toBe(true);
    } finally {
      process.env = prior;
    }
  });

  it('reports a non-zero exit as an error result', async () => {
    const prior = { ...process.env };
    process.env.PINAGENT_AGENT_CLI_COMMAND = JSON.stringify([
      process.execPath,
      '-e',
      'process.exit(3)',
    ]);
    delete process.env.PINAGENT_AGENT_CLI_FORMAT;
    try {
      const events = await collect(new CliAgentProvider(), makeRequest());
      const result = events.find((e) => e.type === 'result') as Extract<
        AgentEvent,
        { type: 'result' }
      >;
      expect(result.subtype).toBe('error');
      expect(result.errors?.[0]).toMatch(/exited with code 3/);
    } finally {
      process.env = prior;
    }
  });

  it('reports a signal-terminated child as an error, not success', async () => {
    const prior = { ...process.env };
    // Child kills itself with SIGKILL: exit `code` is null, `signal` set.
    // Without the signal check this slipped through as `code ?? 0 === 0`.
    process.env.PINAGENT_AGENT_CLI_COMMAND = JSON.stringify([
      process.execPath,
      '-e',
      'process.kill(process.pid, "SIGKILL")',
    ]);
    delete process.env.PINAGENT_AGENT_CLI_FORMAT;
    try {
      const events = await collect(new CliAgentProvider(), makeRequest());
      const result = events.find((e) => e.type === 'result') as Extract<
        AgentEvent,
        { type: 'result' }
      >;
      expect(result.subtype).toBe('error');
      expect(result.errors?.[0]).toMatch(/terminated by signal/);
    } finally {
      process.env = prior;
    }
  });

  it('surfaces a spawn failure (missing command) as a clear error', async () => {
    const prior = { ...process.env };
    process.env.PINAGENT_AGENT_CLI_COMMAND = 'pinagent-no-such-binary-xyz';
    delete process.env.PINAGENT_AGENT_CLI_FORMAT;
    try {
      const events = await collect(new CliAgentProvider(), makeRequest());
      const result = events.find((e) => e.type === 'result') as Extract<
        AgentEvent,
        { type: 'result' }
      >;
      expect(result.subtype).toBe('error');
      // The real ENOENT, not a misleading "exited with code 1".
      expect(result.errors?.[0]).toMatch(/failed to start pinagent-no-such-binary-xyz/);
    } finally {
      process.env = prior;
    }
  });

  it('does not crash when a child exits before reading stdin', async () => {
    const prior = { ...process.env };
    // promptMode=stdin + a child that exits immediately → the prompt write
    // races into a closed pipe (EPIPE). Must be swallowed, not thrown.
    process.env.PINAGENT_AGENT_CLI_COMMAND = JSON.stringify([
      process.execPath,
      '-e',
      'process.exit(0)',
    ]);
    process.env.PINAGENT_AGENT_CLI_PROMPT = 'stdin';
    delete process.env.PINAGENT_AGENT_CLI_FORMAT;
    try {
      const events = await collect(
        new CliAgentProvider(),
        makeRequest({ prompt: 'x'.repeat(100_000) }),
      );
      const result = events.find((e) => e.type === 'result') as Extract<
        AgentEvent,
        { type: 'result' }
      >;
      expect(result.subtype).toBe('success');
    } finally {
      process.env = prior;
    }
  });

  it('tags stderr and excludes it from the turn count', async () => {
    const prior = { ...process.env };
    // One stdout assistant turn + one stderr diagnostic. In stream-json mode
    // the stderr line must stay tagged text (not parsed as JSON) and must not
    // tick the turn counter.
    const stdoutLine = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'editing the file' }] },
    });
    const script = `console.error("warming up model"); console.log(${JSON.stringify(stdoutLine)})`;
    process.env.PINAGENT_AGENT_CLI_COMMAND = JSON.stringify([process.execPath, '-e', script]);
    process.env.PINAGENT_AGENT_CLI_FORMAT = 'stream-json';
    delete process.env.PINAGENT_AGENT_CLI_PROMPT;
    try {
      const events = await collect(new CliAgentProvider(), makeRequest());
      const texts = events
        .filter((e) => e.type === 'text')
        .map((e) => (e as { text: string }).text);
      expect(texts).toContain('editing the file');
      // stderr stayed tagged rather than masquerading as untagged model text.
      expect(texts).toContain('[stderr] warming up model');
      const result = events.find((e) => e.type === 'result') as Extract<
        AgentEvent,
        { type: 'result' }
      >;
      // Only the stdout text counts — stderr did not inflate the turn count.
      expect(result.numTurns).toBe(1);
    } finally {
      process.env = prior;
    }
  });
});
