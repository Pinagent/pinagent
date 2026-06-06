// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/html-vite';
import { STYLES } from '../styles';
import { mountChrome } from './story-mount';

/**
 * Presentational stories for the element-picker chrome and toasts — the
 * `.outline` (hover highlight), `.selection-outline` (queued Cmd/Ctrl-click
 * picks), the `.hint` banner, and the corner `.toast`. All rendered from the
 * real shipped `STYLES`. These elements are `position: fixed` in production
 * (they track the viewport); here their `position` is overridden to
 * `absolute` so they sit inside the story box. For the fully interactive
 * picker that tracks the real cursor, see **Widget/Live**.
 */

const HOST = { width: '560px', height: '320px' };

// A mock host-app element to outline, placed inside the (relative) host box.
// Tagged like a real instrumented app element so it's pickable as the "target".
function demoTarget(host: HTMLElement): HTMLElement {
  const box = document.createElement('div');
  box.textContent = 'Add to cart';
  box.dataset.paLoc = 'src/components/PriceCard.tsx:42:7';
  box.style.cssText =
    'position:absolute;top:160px;left:60px;width:180px;height:44px;display:flex;' +
    'align-items:center;justify-content:center;background:#18181b;color:#fff;border-radius:8px;font-family:system-ui;';
  host.appendChild(box);
  return box;
}

function outlineOver(
  host: HTMLElement,
  cls: string,
  top: number,
  left: number,
  w: number,
  h: number,
) {
  const ol = document.createElement('div');
  ol.className = cls;
  // Dogfood anchor: the two outline variants live in the same stylesheet.
  ol.dataset.paLoc = cls === 'outline' ? 'src/styles.ts:282:1' : 'src/styles.ts:295:1';
  ol.style.position = 'absolute';
  ol.style.top = `${top}px`;
  ol.style.left = `${left}px`;
  ol.style.width = `${w}px`;
  ol.style.height = `${h}px`;
  host.appendChild(ol);
}

function hintBanner(host: HTMLElement, text: string) {
  const hint = document.createElement('div');
  hint.className = 'hint';
  // The banner wording is composed in picker.ts `updatePickHint`.
  hint.dataset.paLoc = 'src/picker.ts:488:1';
  hint.style.position = 'absolute';
  hint.textContent = text;
  host.appendChild(hint);
}

const meta: Meta = {
  title: 'Widget/Picker',
};
export default meta;

type Story = StoryObj;

/** The hover highlight (ink edge, faint gold fill) over the element under
 *  the cursor, plus the picker hint banner. */
export const HoverOutline: Story = {
  render: () =>
    mountChrome(
      STYLES,
      (host) => {
        demoTarget(host);
        outlineOver(host, 'outline', 158, 58, 184, 48);
        hintBanner(host, 'Click an element. Cmd-click to add more. Esc to cancel.');
      },
      HOST,
    ),
};

/** Two queued Cmd/Ctrl-click selections (solid gold edge) alongside the
 *  hover outline — the multi-element pick state. */
export const QueuedSelections: Story = {
  render: () =>
    mountChrome(
      STYLES,
      (host) => {
        demoTarget(host);
        outlineOver(host, 'selection-outline', 40, 60, 220, 90);
        outlineOver(host, 'selection-outline', 158, 58, 184, 48);
        hintBanner(host, '2 selected. Click to comment. Cmd-click to add more. Esc to cancel.');
      },
      HOST,
    ),
};

/** Success toast. */
export const ToastSuccess: Story = {
  render: () =>
    mountChrome(
      STYLES,
      (host) => {
        const t = document.createElement('div');
        t.className = 'toast';
        t.dataset.paLoc = 'src/styles.ts:412:1';
        t.style.position = 'relative';
        t.style.margin = '20px';
        t.textContent = 'Comment sent to the agent';
        host.appendChild(t);
      },
      { width: '320px', height: '80px' },
    ),
};

/** Error toast. */
export const ToastError: Story = {
  render: () =>
    mountChrome(
      STYLES,
      (host) => {
        const t = document.createElement('div');
        t.className = 'toast error';
        t.dataset.paLoc = 'src/styles.ts:412:1';
        t.style.position = 'relative';
        t.style.margin = '20px';
        t.textContent = 'Couldn’t clear agent';
        host.appendChild(t);
      },
      { width: '320px', height: '80px' },
    ),
};
