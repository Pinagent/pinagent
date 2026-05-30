// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/html-vite';
import { composerHTML } from '../composer-html';
import type { QuickAction } from '../quick-actions';
import type { AgentState, ComposerMeta } from '../types';
import { type ComposerFrameOptions, mountComposerFrame } from './story-mount';

/**
 * Stories for the per-element composer — the card that opens when you pick
 * an element. Everything here renders the real `composerHTML()` document
 * (with the shipped `COMPOSER_STYLES` inlined) inside an iframe, exactly
 * like the live widget. The post-submit visual states are driven by the
 * same CSS-only knobs the runtime uses: `body.mini`, `body[data-agent-state]`
 * and `body.needs-input`.
 */

const ICON_BUG = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="6" width="8" height="14" rx="4"/><path d="M3 9h3M18 9h3M3 15h3M18 15h3M12 2v2"/></svg>`;
const ICON_TEXT = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7V5h16v2M9 19h6M12 5v14"/></svg>`;

const SAMPLE_CHIPS: QuickAction[] = [
  { id: 'fix', label: 'Fix this', icon: ICON_BUG, prompt: 'Fix the bug in this element: ' },
  {
    id: 'copy',
    label: 'Edit copy',
    icon: ICON_TEXT,
    prompt: 'Reword the text in this element to ',
  },
];

const SAMPLE_META: ComposerMeta = {
  tag: 'button',
  label: 'Add to cart',
  loc: { file: 'src/components/PriceCard.tsx', line: 42, col: 7 },
  component: 'PriceCard',
  breadcrumbs: ['main', 'section', 'div', 'button'],
  chips: SAMPLE_CHIPS,
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
  render: (args) => mountComposerFrame(html(), args),
};
export default meta;

type Story = StoryObj<ComposerFrameOptions & { agentState: AgentState }>;

/** The pre-submit form: header (element identity + file:line + breadcrumb),
 *  quick-action chips, textarea, and the submit/cancel row. */
export const PreSubmit: Story = {
  args: { pane: 'compose' },
};

/** Multi-element selection — the "+N" badge in the header. */
export const MultiSelectHeader: Story = {
  render: (args) =>
    mountComposerFrame(
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
