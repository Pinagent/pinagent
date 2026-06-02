// SPDX-License-Identifier: Apache-2.0
/**
 * In-process project event pub/sub (src/project-events.ts). Storage emits
 * after every conversation-row write; ws-server subscribes once and fans
 * out to project sockets. The contracts that matter: every live listener
 * sees the event, the disposer detaches exactly that listener, and a
 * throwing listener can't take down the writer that triggered the emit.
 */
import type { ProjectEvent } from '@pinagent/shared';
import { describe, expect, it } from 'vitest';
import { emitProjectChange, onProjectChange } from '../src/project-events';

const CHANGED: ProjectEvent = { type: 'conversations_changed' };

describe('project-events', () => {
  it('delivers an emitted event to a subscribed listener', () => {
    const seen: ProjectEvent[] = [];
    const off = onProjectChange((e) => seen.push(e));
    emitProjectChange(CHANGED);
    off();
    expect(seen).toEqual([CHANGED]);
  });

  it('fans out a single emit to every live listener', () => {
    const hits: string[] = [];
    const off1 = onProjectChange(() => hits.push('one'));
    const off2 = onProjectChange(() => hits.push('two'));
    emitProjectChange(CHANGED);
    off1();
    off2();
    expect(hits.sort()).toEqual(['one', 'two']);
  });

  it('stops delivering to a listener after its disposer runs', () => {
    const seen: ProjectEvent[] = [];
    const off = onProjectChange((e) => seen.push(e));
    off();
    emitProjectChange(CHANGED);
    expect(seen).toHaveLength(0);
  });

  it('isolates a throwing listener — other listeners and the emit still complete', () => {
    const seen: string[] = [];
    const offBad = onProjectChange(() => {
      throw new Error('listener blew up');
    });
    const offGood = onProjectChange(() => seen.push('good'));
    expect(() => emitProjectChange(CHANGED)).not.toThrow();
    offBad();
    offGood();
    expect(seen).toEqual(['good']);
  });
});
