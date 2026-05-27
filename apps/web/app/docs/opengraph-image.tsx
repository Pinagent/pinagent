// SPDX-License-Identifier: Apache-2.0
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '../_components/og';

export const alt = 'Pinagent docs — install, MCP setup, and the feedback record format';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function DocsOgImage() {
  return renderOgImage({
    eyebrow: 'Docs',
    title: 'Install, connect, and address pending feedback.',
  });
}
