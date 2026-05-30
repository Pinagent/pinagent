// SPDX-License-Identifier: Apache-2.0
import { Button } from '@pinagent/ui/components/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnchorChip } from '../components/AnchorChip';
import { CostChip } from '../components/CostChip';
import { ListRow } from '../components/ListRow';

/**
 * The dock's canonical list row — shared by Overview, Conversations, and
 * Changes so the density and rhythm carry across screens. The `meta` slot
 * below composes the real AnchorChip + CostChip the production lists use.
 */
const meta: Meta<typeof ListRow> = {
  title: 'Dock/ListRow',
  component: ListRow,
  decorators: [
    (Story) => (
      <div style={{ width: 380 }}>
        <Story />
      </div>
    ),
  ],
  argTypes: {
    status: {
      control: 'select',
      options: [
        'pending',
        'working',
        'awaitingClarification',
        'readyToLand',
        'landed',
        'discarded',
        'error',
      ],
    },
    title: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<typeof ListRow>;

const rowMeta = (
  <>
    <AnchorChip loc="src/marketing/Hero.tsx:42:8" selector="button.cta" bare />
    <span className="truncate">Make the CTA button larger and higher-contrast</span>
  </>
);

const recently = new Date(Date.now() - 9 * 60_000).toISOString();

/** A fresh, unworked conversation. */
export const Pending: Story = {
  args: {
    status: 'pending',
    title: 'Make the CTA button larger',
    meta: rowMeta,
    updatedAt: recently,
  },
};

/** Agent mid-run — the status dot pulses. */
export const Working: Story = {
  args: {
    status: 'working',
    title: 'Refactor the pricing grid',
    meta: rowMeta,
    updatedAt: recently,
  },
};

/** Finished, waiting to land — with a running-cost chip in the meta line. */
export const ReadyToLand: Story = {
  args: {
    status: 'readyToLand',
    title: 'Fix the price alignment',
    meta: (
      <>
        <AnchorChip loc="src/components/PriceCard.tsx:13:5" bare />
        <CostChip cost={1.08} cap={5} />
      </>
    ),
    updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  },
};

/** With a right-side action cluster. */
export const WithActions: Story = {
  args: {
    status: 'awaitingClarification',
    title: 'Which font should the heading use?',
    meta: rowMeta,
    updatedAt: recently,
    onClick: () => {},
    actions: (
      <Button size="sm" variant="ghost" className="h-7 text-xs">
        Answer
      </Button>
    ),
  },
};

/** Selected in a multi-select (left checkbox + selected styling). */
export const MultiSelectSelected: Story = {
  args: {
    status: 'pending',
    title: 'Tidy up the footer links',
    meta: rowMeta,
    updatedAt: recently,
    selected: true,
    onClick: () => {},
    onSelectChange: () => {},
  },
};
