// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { composerHTML } from '../src/composer-html';
import { wireComposerIframe } from '../src/composer-iframe';
import type { ComposerMeta } from '../src/types';

const META: ComposerMeta = {
  tag: 'button',
  label: 'Add to cart',
  loc: { file: 'src/components/PriceCard.tsx', line: 42, col: 7 },
  component: 'PriceCard',
  breadcrumbs: ['main', 'section', 'div', 'button'],
  extraCount: 0,
  extras: [],
};

/**
 * Stand up a real composer iframe document and wire it exactly as the runtime
 * does, with the breadcrumb callbacks spied. The fresh (pre-submit) path is
 * what owns the pressable-crumb affordance, so the stub composer leaves
 * `feedbackId` null. Everything else `wireComposerIframe` touches on that path
 * is a listener attachment — only `resolveDockEnabled` (window config) and the
 * crumb wiring run side-effects, both safe here.
 */
function wireFreshComposer() {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument as Document;
  idoc.open();
  idoc.write(composerHTML(META));
  idoc.close();

  const onCrumbHover = vi.fn();
  const onCrumbLeave = vi.fn();
  const onCrumbPress = vi.fn();

  const composer = {
    feedbackId: null,
    expanded: true,
    minimize: vi.fn(),
    close: vi.fn(),
    toBubble: vi.fn(),
  };
  const ctx = {
    dockEnabled: false,
    isMac: false,
    wsClient: { sendInterrupt: vi.fn() },
    enterPicking: vi.fn(),
    pickRouteComposer: null,
    state: { mode: 'idle' },
  };

  // biome-ignore lint/suspicious/noExplicitAny: minimal stub for the fresh path
  wireComposerIframe({
    ctx: ctx as any,
    composer: composer as any,
    iframe,
    click: { x: 0, y: 0 },
    loc: META.loc as any,
    selector: 'button',
    setAgentState: vi.fn(),
    applyMiniChrome: vi.fn(),
    swapTo: vi.fn(),
    hopToNextActive: vi.fn(),
    onExtrasHover: vi.fn(),
    onExtrasLeave: vi.fn(),
    onCrumbHover,
    onCrumbLeave,
    onCrumbPress,
    onTextareaHeight: vi.fn(),
  } as any);

  return { idoc, onCrumbHover, onCrumbLeave, onCrumbPress };
}

describe('wireComposerIframe breadcrumb interactivity', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('marks ancestor crumbs (up>0) pressable and leaves the picked crumb (up=0) plain', () => {
    const { idoc } = wireFreshComposer();
    const crumbs = Array.from(idoc.querySelectorAll<HTMLElement>('.bc-item[data-bc-up]'));
    expect(crumbs.length).toBe(4);
    for (const crumb of crumbs) {
      const up = Number(crumb.dataset.bcUp);
      if (up === 0) {
        expect(crumb.classList.contains('bc-pressable')).toBe(false);
        expect(crumb.getAttribute('role')).toBe(null);
      } else {
        expect(crumb.classList.contains('bc-pressable')).toBe(true);
        expect(crumb.getAttribute('role')).toBe('button');
      }
    }
  });

  it('fires onCrumbHover with the crumb distance on mouseenter (every crumb)', () => {
    const { idoc, onCrumbHover } = wireFreshComposer();
    const crumb = idoc.querySelector<HTMLElement>('.bc-item[data-bc-up="2"]');
    crumb?.dispatchEvent(new Event('mouseenter'));
    expect(onCrumbHover).toHaveBeenCalledWith(2);
  });

  it('fires onCrumbPress with the crumb distance when an ancestor crumb is clicked', () => {
    const { idoc, onCrumbPress, onCrumbLeave } = wireFreshComposer();
    const crumb = idoc.querySelector<HTMLElement>('.bc-item[data-bc-up="3"]');
    crumb?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCrumbLeave).toHaveBeenCalled();
    expect(onCrumbPress).toHaveBeenCalledWith(3);
  });

  it('does not make the picked crumb (up=0) a press target', () => {
    const { idoc, onCrumbPress } = wireFreshComposer();
    const crumb = idoc.querySelector<HTMLElement>('.bc-item[data-bc-up="0"]');
    crumb?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onCrumbPress).not.toHaveBeenCalled();
  });
});
