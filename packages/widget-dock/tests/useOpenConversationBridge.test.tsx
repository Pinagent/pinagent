// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Cover the `open-conversation` host-bridge handler in
 * `useOpenConversationBridge`. Both widget entry points (the composer's
 * "open in dock" button and the agent tray's per-row "Open") post the
 * same `{ source: 'pinagent-host', type: 'open-conversation', feedbackId }`
 * frame; the hook opens the dock and navigates to that conversation.
 *
 * `useNavigate` is mocked so the hook needs no router context.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ROUTE_PATHS } from '../src/route-paths';
import { useOpenConversationBridge } from '../src/shell/useOpenConversationBridge';

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let open: ReturnType<typeof vi.fn>;

function Harness() {
  useOpenConversationBridge(open);
  return null;
}

function mount(): void {
  act(() => {
    root.render(<Harness />);
  });
}

function postHost(data: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
}

beforeEach(() => {
  navigateSpy.mockReset();
  open = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useOpenConversationBridge', () => {
  it('opens and navigates to the conversation on open-conversation', () => {
    mount();
    postHost({ source: 'pinagent-host', type: 'open-conversation', feedbackId: 'fb_abc123' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith({
      to: ROUTE_PATHS.conversations,
      search: { id: 'fb_abc123' },
    });
  });

  it('opens unconditionally so it works whether the dock is open or closed', () => {
    // `open` is idempotent (setOpen(true)); the same path serves "open the
    // closed dock to it" and "navigate the already-open dock".
    mount();
    postHost({ source: 'pinagent-host', type: 'open-conversation', feedbackId: 'fb_xyz' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith({
      to: ROUTE_PATHS.conversations,
      search: { id: 'fb_xyz' },
    });
  });

  it('ignores open-conversation with a missing feedbackId', () => {
    mount();
    postHost({ source: 'pinagent-host', type: 'open-conversation' });
    expect(open).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores open-conversation with an empty feedbackId', () => {
    mount();
    postHost({ source: 'pinagent-host', type: 'open-conversation', feedbackId: '' });
    expect(open).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores open-conversation with a non-string feedbackId', () => {
    mount();
    postHost({ source: 'pinagent-host', type: 'open-conversation', feedbackId: 42 });
    expect(open).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores frames from other sources or wrong type', () => {
    mount();
    postHost({ source: 'pinagent-dock', type: 'open-conversation', feedbackId: 'fb_1' });
    postHost({ type: 'open-conversation', feedbackId: 'fb_1' });
    postHost({ source: 'pinagent-host', type: 'toggle-dock', feedbackId: 'fb_1' });
    expect(open).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('detaches the listener on unmount', () => {
    mount();
    act(() => root.unmount());
    postHost({ source: 'pinagent-host', type: 'open-conversation', feedbackId: 'fb_1' });
    expect(open).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
    // Re-mount so afterEach's unmount has a live root.
    root = createRoot(container);
    mount();
  });
});
