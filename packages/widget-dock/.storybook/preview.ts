// SPDX-License-Identifier: Apache-2.0
import type { Preview } from '@storybook/react-vite';
// The dock's real stylesheet: pulls in @pinagent/ui's tokens + Tailwind base
// and scans the dock source for utilities (see styles/globals.css @source).
import '../src/styles/globals.css';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
  },
};

export default preview;
