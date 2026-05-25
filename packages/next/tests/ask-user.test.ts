import { describe, expect, it } from 'vitest';
import { ASK_USER_TOOL_NAME, rejectAsk, resolveAsk } from '../src/ask-user';

/**
 * Unit-test surface for ask-user.
 *
 * The handler returned by `createAskUserMcpServer` closes over a
 * private `pending` Map and is invoked by the SDK's MCP machinery,
 * not by user code. We can't unit-test the handler-resolve round-trip
 * without driving the SDK — that's a Layer-2 integration test.
 *
 * What we CAN test cheaply at the unit level:
 *  - the public tool name shape (the system prompt and allowedTools
 *    list depend on this exact string)
 *  - resolveAsk returns false for unknown ids (so the WS server can
 *    report "no pending ask <id>" upstream)
 *  - rejectAsk is a no-op on feedback ids with no pending entries
 */

describe('ask-user', () => {
  describe('ASK_USER_TOOL_NAME', () => {
    it('uses the MCP namespacing the SDK expects', () => {
      // Format: `mcp__<server-name>__<tool-name>`.
      // Anything else and the allowedTools entry in agent.ts wouldn't
      // match what the model emits, and the call would get prompted
      // for permission instead of auto-allowed.
      expect(ASK_USER_TOOL_NAME).toBe('mcp__pinpoint-ask-user__ask_user');
    });
  });

  describe('resolveAsk', () => {
    it('returns false for an unknown askId', () => {
      expect(resolveAsk(`unknown-${Date.now()}`, 'hi')).toBe(false);
    });

    it('returns false for an empty askId', () => {
      expect(resolveAsk('', 'hi')).toBe(false);
    });
  });

  describe('rejectAsk', () => {
    it('is a no-op for a feedbackId with no pending asks', () => {
      expect(() => rejectAsk(`no-asks-${Date.now()}`, 'gone')).not.toThrow();
    });

    it('is safe to call repeatedly', () => {
      const id = `repeat-${Date.now()}`;
      expect(() => {
        rejectAsk(id, 'first');
        rejectAsk(id, 'second');
        rejectAsk(id, 'third');
      }).not.toThrow();
    });
  });
});
