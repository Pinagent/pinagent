// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
/**
 * Cover the host-bridge `message` handler inside `useKeyboardShortcuts`
 * — the part the pure `matchKeyboardShortcut` tests can't reach. The
 * host page posts `{ source: 'pinagent-host', ... }` frames into the
 * dock iframe; here we render the hook and dispatch those frames.
 *
 *   - `toggle-dock` → onToggle()
 *
 * `open-conversation` is owned by `useOpenConversationBridge` now — see
 * `useOpenConversationBridge.test.tsx`.
 *
 * `useNavigate` is mocked so the hook needs no router context.
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardShortcuts } from '../src/shell/useKeyboardShortcuts';

const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let onToggle: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;

function mount(opts?: { isOpen?: boolean; embedded?: boolean }): void {
  act(() => {
    root.render(<Harness isOpen={opts?.isOpen ?? false} embedded={opts?.embedded ?? true} />);
  });
}

function Harness({ isOpen, embedded }: { isOpen: boolean; embedded: boolean }) {
  useKeyboardShortcuts({ onToggle, open, isOpen, embedded });
  return null;
}

function postHost(data: Record<string, unknown>): void {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data }));
  });
}

beforeEach(() => {
  navigateSpy.mockReset();
  onToggle = vi.fn();
  open = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useKeyboardShortcuts host-bridge messages', () => {
  it('toggles on a toggle-dock frame', () => {
    mount();
    postHost({ source: 'pinagent-host', type: 'toggle-dock' });
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('ignores frames from other sources', () => {
    mount();
    postHost({ source: 'pinagent-dock', type: 'toggle-dock' });
    postHost({ type: 'toggle-dock' });
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('no longer handles open-conversation (moved to useOpenConversationBridge)', () => {
    mount();
    postHost({ source: 'pinagent-host', type: 'open-conversation', feedbackId: 'fb_abc123' });
    expect(open).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('detaches the listener on unmount', () => {
    mount();
    act(() => root.unmount());
    postHost({ source: 'pinagent-host', type: 'toggle-dock' });
    expect(onToggle).not.toHaveBeenCalled();
    // Re-mount so afterEach's unmount has a live root.
    root = createRoot(container);
    mount();
  });
});
