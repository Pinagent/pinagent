// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/react-vite';
import { CostChip } from '../components/CostChip';

/**
 * Running-cost chip. Color-shifts from muted → warn → error as spend
 * approaches the per-conversation cap; relabels to "subscription" for
 * notional (OAuth/subscription) runs.
 */
const meta: Meta<typeof CostChip> = {
  title: 'Dock/CostChip',
  component: CostChip,
  argTypes: {
    cost: { control: { type: 'number', step: 0.01 } },
    cap: { control: { type: 'number', step: 0.5 } },
    size: { control: 'inline-radio', options: ['sm', 'md'] },
    prefix: { control: 'text' },
  },
};
export default meta;

type Story = StoryObj<typeof CostChip>;

/** No cap configured — plain running total, muted tone. */
export const NoCap: Story = {
  args: { cost: 0.12, cap: null },
};

/** Well under the cap — muted. */
export const UnderCap: Story = {
  args: { cost: 0.34, cap: 5 },
};

/** Approaching the cap — warn tone. */
export const NearCap: Story = {
  args: { cost: 4.2, cap: 5 },
};

/** Over the cap — error tone (the next turn will be refused). */
export const OverCap: Story = {
  args: { cost: 6.5, cap: 5 },
};

/** Notional cost — billed against a Claude subscription, not a card. */
export const Subscription: Story = {
  args: { cost: 0.42, cap: null, apiKeySource: 'oauth' },
};
