// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/html-vite';
import { STYLES } from '../styles';
import { mountShadow } from './story-mount';

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

// A mock element to outline, placed inside the (relative) host box.
function demoTarget(root: ShadowRoot): HTMLElement {
  const box = document.createElement('div');
  box.textContent = 'Add to cart';
  box.style.cssText =
    'position:absolute;top:160px;left:60px;width:180px;height:44px;display:flex;' +
    'align-items:center;justify-content:center;background:#18181b;color:#fff;border-radius:8px;font-family:system-ui;';
  root.appendChild(box);
  return box;
}

function outlineOver(
  root: ShadowRoot,
  cls: string,
  top: number,
  left: number,
  w: number,
  h: number,
) {
  const ol = document.createElement('div');
  ol.className = cls;
  ol.style.position = 'absolute';
  ol.style.top = `${top}px`;
  ol.style.left = `${left}px`;
  ol.style.width = `${w}px`;
  ol.style.height = `${h}px`;
  root.appendChild(ol);
}

function hintBanner(root: ShadowRoot, text: string) {
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.style.position = 'absolute';
  hint.textContent = text;
  root.appendChild(hint);
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
    mountShadow(
      STYLES,
      (root) => {
        demoTarget(root);
        outlineOver(root, 'outline', 158, 58, 184, 48);
        hintBanner(root, 'Click an element. Cmd-click to add more. Esc to cancel.');
      },
      HOST,
    ),
};

/** Two queued Cmd/Ctrl-click selections (solid gold edge) alongside the
 *  hover outline — the multi-element pick state. */
export const QueuedSelections: Story = {
  render: () =>
    mountShadow(
      STYLES,
      (root) => {
        demoTarget(root);
        outlineOver(root, 'selection-outline', 40, 60, 220, 90);
        outlineOver(root, 'selection-outline', 158, 58, 184, 48);
        hintBanner(root, '2 selected. Click to comment. Cmd-click to add more. Esc to cancel.');
      },
      HOST,
    ),
};

/** Success toast. */
export const ToastSuccess: Story = {
  render: () =>
    mountShadow(
      STYLES,
      (root) => {
        const t = document.createElement('div');
        t.className = 'toast';
        t.style.position = 'relative';
        t.style.margin = '20px';
        t.textContent = 'Comment sent to the agent';
        root.appendChild(t);
      },
      { width: '320px', height: '80px' },
    ),
};

/** Error toast. */
export const ToastError: Story = {
  render: () =>
    mountShadow(
      STYLES,
      (root) => {
        const t = document.createElement('div');
        t.className = 'toast error';
        t.style.position = 'relative';
        t.style.margin = '20px';
        t.textContent = 'Couldn’t clear agent';
        root.appendChild(t);
      },
      { width: '320px', height: '80px' },
    ),
};
