// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/html-vite';
import type { RawFeedback } from '../agent-tray';
import { buildDemoApp, installFakeApi, mountLiveWidget } from './live-widget';

/**
 * The whole widget, live. These stories wire the real controllers
 * (`createComposerController` / `createPicker` / `createFabTray`) the same
 * way `mount()` does, against a faked `/__pinagent` API and an inert WS
 * client — so picking, the composer iframe, FAB drag/snap, and the
 * running-agents tray are all interactive. See `live-widget.ts`.
 */

const SAMPLE_AGENTS: RawFeedback[] = [
  {
    id: 'a1',
    title: 'Make the CTA button larger',
    comment: 'Make the CTA button larger',
    selector: 'button.cta',
    status: 'pending',
    worktreeState: 'none',
    isRunning: true,
    messageCount: 5,
    totalCostUsd: 0.34,
  },
  {
    // fixed + active worktree → readyToLand
    id: 'a2',
    title: 'Fix the price alignment',
    comment: 'Fix the price alignment on the pricing card',
    selector: 'div.price',
    status: 'fixed',
    worktreeState: 'active',
    messageCount: 12,
    totalCostUsd: 1.08,
  },
  {
    // deferred → awaitingClarification (agent is waiting on the developer)
    id: 'a3',
    title: 'Which font should the heading use?',
    comment: 'Update the heading font',
    selector: 'h3',
    status: 'deferred',
    worktreeState: 'none',
    messageCount: 3,
    totalCostUsd: 0.12,
  },
];

interface WidgetArgs {
  agents: RawFeedback[];
  dockEnabled: boolean;
}

function renderLive(args: WidgetArgs): HTMLElement {
  const restore = installFakeApi(args.agents);
  const container = buildDemoApp();
  const handle = mountLiveWidget({ dockEnabled: args.dockEnabled });
  // Restore fetch when this story's node leaves the DOM (next story switch
  // re-mounts and tears the previous live widget down too — see live-widget).
  const observer = new MutationObserver(() => {
    if (!container.isConnected) {
      handle.destroy();
      restore();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return container;
}

const meta: Meta<WidgetArgs> = {
  title: 'Widget/Live',
  parameters: { layout: 'fullscreen' },
  argTypes: {
    dockEnabled: { control: 'boolean', description: 'Show dock shortcut chip + Open buttons' },
  },
  args: { dockEnabled: false },
  render: renderLive,
};
export default meta;

type Story = StoryObj<WidgetArgs>;

/** No agents running — the collapsed pin. Click it to pick an element, then
 *  click a card element to open a real composer over it. */
export const Idle: Story = {
  args: { agents: [] },
};

/** The running-agents tray populated with a mix of states (working /
 *  ready-to-land / needs-input). Drag the handle to snap corners; Stop /
 *  Clear / minimize are wired. */
export const WithRunningAgents: Story = {
  args: { agents: SAMPLE_AGENTS },
};

/** Dock enabled — the pin grows the ⌘⇧P chip and tray rows gain "Open". */
export const DockEnabled: Story = {
  args: { agents: SAMPLE_AGENTS, dockEnabled: true },
};
