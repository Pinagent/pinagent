// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/html-vite';
import { composerHTML } from '../composer-html';
import type { AgentState, ComposerMeta } from '../types';
import { type ComposerFrameOptions, mountComposer } from './story-mount';

/**
 * Stories for the per-element composer — the card that opens when you pick
 * an element. Everything here renders the real `composerHTML()` document
 * (with the shipped `COMPOSER_STYLES`), lifted into the light DOM so the
 * dogfood picker can target individual controls. The post-submit visual
 * states are driven by the same CSS-only knobs the runtime uses, rewritten
 * onto the composer root: `.mini`, `[data-agent-state]` and `.needs-input`.
 */

const SAMPLE_META: ComposerMeta = {
  tag: 'button',
  label: 'Add to cart',
  loc: { file: 'src/components/PriceCard.tsx', line: 42, col: 7 },
  component: 'PriceCard',
  breadcrumbs: ['main', 'section', 'div', 'button'],
  extraCount: 0,
  extras: [],
};

// One source of truth for the rendered document; stories vary only the
// post-load state knobs.
const html = (meta: ComposerMeta = SAMPLE_META) => composerHTML(meta);

const meta: Meta<ComposerFrameOptions & { agentState: AgentState }> = {
  title: 'Widget/Composer',
  argTypes: {
    pane: { control: 'inline-radio', options: ['compose', 'stream'] },
    mini: { control: 'boolean' },
    needsInput: { control: 'boolean' },
    agentState: {
      control: 'inline-radio',
      options: ['pending', 'running', 'done', 'error'],
    },
    label: { control: 'text' },
  },
  render: (args) => mountComposer(html(), args),
};
export default meta;

type Story = StoryObj<ComposerFrameOptions & { agentState: AgentState }>;

/** The pre-submit form: header (element identity + file:line + breadcrumb),
 *  textarea, and the submit/cancel row. */
export const PreSubmit: Story = {
  args: { pane: 'compose' },
};

/** Multi-element selection — the "+N" badge in the header. */
export const MultiSelectHeader: Story = {
  render: (args) =>
    mountComposer(
      html({
        ...SAMPLE_META,
        extraCount: 2,
        extras: [
          {
            tag: 'span',
            label: 'Price',
            loc: { file: 'src/components/PriceCard.tsx', line: 38, col: 9 },
          },
          {
            tag: 'img',
            label: null,
            loc: { file: 'src/components/PriceCard.tsx', line: 31, col: 5 },
          },
        ],
      }),
      args,
    ),
  args: { pane: 'compose' },
};

/** The single-line mini bar while the agent runs (spinner + activity label). */
export const MiniRunning: Story = {
  args: { pane: 'stream', mini: true, agentState: 'running', label: 'Editing PriceCard.tsx…' },
};

/** Mini bar, run finished — the drawn green check + "ready to land" border. */
export const MiniDone: Story = {
  args: { pane: 'stream', mini: true, agentState: 'done', label: 'Done' },
};

/** Mini bar, run errored — the ✕ indicator + error border. */
export const MiniError: Story = {
  args: { pane: 'stream', mini: true, agentState: 'error', label: 'Agent failed' },
};

/** Mini bar, agent is asking a question — the alert indicator + answer icon. */
export const MiniNeedsInput: Story = {
  args: {
    pane: 'stream',
    mini: true,
    agentState: 'running',
    needsInput: true,
    label: 'Needs your input',
  },
};

/** The expanded stream pane (transcript + follow-up + footer actions). */
export const StreamExpanded: Story = {
  args: { pane: 'stream', mini: false, agentState: 'running', label: 'Working…' },
};
