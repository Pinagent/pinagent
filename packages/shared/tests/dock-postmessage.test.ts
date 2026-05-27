// SPDX-License-Identifier: Apache-2.0
/**
 * Pin the dock ↔ host postMessage protocol shapes. Both sides of the
 * boundary (dock iframe and host relay) parse with these schemas; this
 * file is the canonical answer to "what does a valid frame look like."
 *
 * The transport class that uses the schemas lands in a follow-up
 * phase — these tests guard the contract now so future implementations
 * have a stable target.
 */
import { describe, expect, it } from 'vitest';
import { DockToHostSchema, HostToDockSchema } from '../src/dock-postmessage';

describe('DockToHostSchema', () => {
  it('accepts a query frame', () => {
    expect(
      DockToHostSchema.safeParse({
        type: 'query',
        id: 'q-1',
        path: '/__pinagent/feedback',
      }).success,
    ).toBe(true);
  });

  it('accepts a query frame with params', () => {
    expect(
      DockToHostSchema.safeParse({
        type: 'query',
        id: 'q-1',
        path: '/__pinagent/history',
        params: { q: 'hello' },
      }).success,
    ).toBe(true);
  });

  it('accepts a mutate frame', () => {
    expect(
      DockToHostSchema.safeParse({
        type: 'mutate',
        id: 'm-1',
        path: '/__pinagent/prs',
        body: { branchName: 'x', title: 'y' },
      }).success,
    ).toBe(true);
  });

  it('accepts subscribe / unsubscribe', () => {
    expect(
      DockToHostSchema.safeParse({
        type: 'subscribe',
        channel: 'project',
        subscriptionId: 's-1',
      }).success,
    ).toBe(true);
    expect(DockToHostSchema.safeParse({ type: 'unsubscribe', subscriptionId: 's-1' }).success).toBe(
      true,
    );
  });

  it('accepts open-popup and ui-event', () => {
    expect(
      DockToHostSchema.safeParse({
        type: 'open-popup',
        url: 'https://github.com/login',
        subscriptionId: 'p-1',
      }).success,
    ).toBe(true);
    expect(
      DockToHostSchema.safeParse({
        type: 'ui-event',
        event: 'open',
      }).success,
    ).toBe(true);
  });

  it('rejects an empty id on query', () => {
    expect(DockToHostSchema.safeParse({ type: 'query', id: '', path: '/x' }).success).toBe(false);
  });

  it('rejects an unknown ui-event', () => {
    expect(DockToHostSchema.safeParse({ type: 'ui-event', event: 'wiggle' }).success).toBe(false);
  });

  it('rejects a non-URL open-popup target', () => {
    expect(
      DockToHostSchema.safeParse({
        type: 'open-popup',
        url: 'not a url',
        subscriptionId: 'p-1',
      }).success,
    ).toBe(false);
  });

  it('rejects an unknown frame type', () => {
    expect(DockToHostSchema.safeParse({ type: 'nope', id: 'x', path: '/y' }).success).toBe(false);
  });
});

describe('HostToDockSchema', () => {
  it('accepts a successful response', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'response',
        id: 'q-1',
        ok: true,
        data: { foo: 'bar' },
      }).success,
    ).toBe(true);
  });

  it('accepts a failure response with code+message', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'response',
        id: 'q-1',
        ok: false,
        error: { code: 'GITHUB_TOKEN_INVALID', message: 'token rejected' },
      }).success,
    ).toBe(true);
  });

  it('accepts a subscription event', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'event',
        subscriptionId: 's-1',
        payload: { type: 'conversations_changed' },
      }).success,
    ).toBe(true);
  });

  it('accepts a popup-closed frame', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'popup-closed',
        subscriptionId: 'p-1',
        result: { token: 'xyz' },
      }).success,
    ).toBe(true);
  });

  it('accepts a host-context frame', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'host-context',
        payload: {
          url: 'http://localhost:3000/checkout',
          viewport: { w: 1280, h: 720 },
          theme: 'dark',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects a response missing the discriminator side of ok', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'response',
        id: 'q-1',
        // neither ok:true with data nor ok:false with error
      }).success,
    ).toBe(false);
  });

  it('rejects a host-context with an unknown theme', () => {
    expect(
      HostToDockSchema.safeParse({
        type: 'host-context',
        payload: {
          url: 'http://localhost',
          viewport: { w: 1, h: 1 },
          theme: 'midnight',
        },
      }).success,
    ).toBe(false);
  });
});
