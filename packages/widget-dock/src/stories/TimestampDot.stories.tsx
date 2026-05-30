// SPDX-License-Identifier: Apache-2.0
import type { Meta, StoryObj } from '@storybook/react-vite';
import { TimestampDot } from '../components/TimestampDot';

/**
 * Right-aligned relative timestamp for list rows; absolute time in the
 * `title` tooltip. Relative to "now", so the rendered label drifts with
 * wall-clock — the offsets below are computed from render time.
 */
const meta: Meta<typeof TimestampDot> = {
  title: 'Dock/TimestampDot',
  component: TimestampDot,
};
export default meta;

type Story = StoryObj<typeof TimestampDot>;

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

export const JustNow: Story = { args: { iso: ago(15_000) } };
export const MinutesAgo: Story = { args: { iso: ago(8 * 60_000) } };
export const HoursAgo: Story = { args: { iso: ago(5 * 3_600_000) } };
export const DaysAgo: Story = { args: { iso: ago(3 * 86_400_000) } };
