// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/html-vite';
import { BRAND_CREAM } from '../brand';
import { buildPinIcon } from '../pin-icon';
import { STYLES } from '../styles';
import { mountShadow } from './story-mount';

/**
 * The floating action button. The live FAB is built imperatively by
 * `createFabTray(ctx)` and is coupled to a `WidgetContext` (WS client,
 * shared state, cross-controller callbacks), so its full interactive
 * tray isn't shown here. This story renders the collapsed pin presentation
 * from the real `STYLES` + `buildPinIcon()` — enough to design the resting
 * and picker-active states. A `fakeCtx()` stub would unlock the running-
 * agents tray as a follow-up.
 */

interface FabArgs {
  active: boolean;
}

function buildFab(active: boolean): HTMLElement {
  return mountShadow(STYLES, (root) => {
    const fab = document.createElement('div');
    fab.className = active ? 'fab active' : 'fab';
    fab.setAttribute('role', 'button');
    // The live FAB anchors to the viewport corner; pin it inside the
    // story box instead so it stays visible on the canvas.
    fab.style.position = 'absolute';
    fab.style.bottom = '20px';
    fab.style.right = '20px';
    fab.appendChild(buildPinIcon(22, BRAND_CREAM));
    root.appendChild(fab);
  });
}

const meta: Meta<FabArgs> = {
  title: 'Widget/FAB',
  argTypes: {
    active: { control: 'boolean', description: 'Picker mode — gold ring' },
  },
  render: (args) => buildFab(args.active),
};
export default meta;

type Story = StoryObj<FabArgs>;

/** Resting pin — idle, waiting for a click to enter picking mode. */
export const Idle: Story = { args: { active: false } };

/** Picker active — gold ring signals "click an element next". */
export const PickerActive: Story = { args: { active: true } };
