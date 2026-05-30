// SPDX-License-Identifier: Apache-2.0
import type { Preview } from '@storybook/html-vite';

const preview: Preview = {
  parameters: {
    layout: 'centered',
    controls: { expanded: true },
    backgrounds: {
      // The widget overlays host pages; preview it on a representative app
      // surface rather than pure white so contrast reads honestly.
      default: 'app',
      values: [
        { name: 'app', value: '#f4f4f5' },
        { name: 'white', value: '#ffffff' },
        { name: 'dark', value: '#18181b' },
      ],
    },
  },
};

export default preview;
