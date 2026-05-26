import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAgentMode, resolvePermissionMode } from '../src/agent';

/**
 * Helper to call the resolver with a stubbed env. The resolver takes
 * a ProcessEnv-shaped object directly, so we don't need to mutate
 * process.env — we just pass our own.
 */
const env = (val?: string): NodeJS.ProcessEnv =>
  val === undefined ? {} : { PINAGENT_SPAWN_AGENT: val };

const permEnv = (val?: string): NodeJS.ProcessEnv =>
  val === undefined ? {} : { PINAGENT_AGENT_PERMISSION_MODE: val };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveAgentMode', () => {
  it('returns inline when env is unset (V2 default)', () => {
    expect(resolveAgentMode(env())).toBe('inline');
  });

  it('returns inline for "inline"', () => {
    expect(resolveAgentMode(env('inline'))).toBe('inline');
  });

  it('returns worktree for "worktree"', () => {
    expect(resolveAgentMode(env('worktree'))).toBe('worktree');
  });

  it('returns false for "off"', () => {
    expect(resolveAgentMode(env('off'))).toBe(false);
  });

  it('returns false for the legacy "false" string', () => {
    expect(resolveAgentMode(env('false'))).toBe(false);
  });

  it('falls back to inline for unknown values', () => {
    expect(resolveAgentMode(env('something-weird'))).toBe('inline');
    expect(resolveAgentMode(env(''))).toBe('inline');
  });
});

describe('resolvePermissionMode', () => {
  it('returns acceptEdits when env is unset (default)', () => {
    expect(resolvePermissionMode(permEnv())).toBe('acceptEdits');
  });

  it.each(['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'] as const)(
    'accepts the documented mode %s',
    (mode) => {
      expect(resolvePermissionMode(permEnv(mode))).toBe(mode);
    },
  );

  it('falls back to acceptEdits for unknown values', () => {
    expect(resolvePermissionMode(permEnv('rude'))).toBe('acceptEdits');
    expect(resolvePermissionMode(permEnv('YOLO'))).toBe('acceptEdits');
    expect(resolvePermissionMode(permEnv(''))).toBe('acceptEdits');
  });
});
