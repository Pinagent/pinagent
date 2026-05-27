// SPDX-License-Identifier: Apache-2.0
import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from './_components/og';

export const alt = 'Pinagent — click any element, comment, your coding agent fixes it';
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function OgImage() {
  return renderOgImage({
    title: 'Click any element. Comment. Your coding agent fixes it.',
  });
}
