// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/react-vite';
import { AnchorChip } from '../components/AnchorChip';

/**
 * Compact `file:line:col` anchor descriptor. Renders as a button that
 * opens the location in VSCode when the loc parses as an anchor; falls
 * back to a non-interactive span otherwise. Safe to render in isolation —
 * the ExtensionLaunch context has a no-op default.
 */
const meta: Meta<typeof AnchorChip> = {
  title: 'Dock/AnchorChip',
  component: AnchorChip,
  argTypes: {
    loc: { control: 'text' },
    selector: { control: 'text' },
    bare: { control: 'boolean' },
  },
};
export default meta;

type Story = StoryObj<typeof AnchorChip>;

/** Parseable anchor — interactive (opens in VSCode), shows file icon. */
export const Openable: Story = {
  args: { loc: 'src/marketing/Hero.tsx:42:8', selector: 'button.cta' },
};

/** Dense variant without the file icon. */
export const Bare: Story = {
  args: { loc: 'src/components/PriceCard.tsx:16:5', bare: true },
};

/** Unparseable loc — non-interactive span fallback. */
export const Fallback: Story = {
  args: { loc: 'unknown-location' },
};
