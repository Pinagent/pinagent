// SPDX-License-Identifier: Apache-2.0
/**
 * Screenshot capture — the RN analog of the web widget's `html-to-image`.
 *
 * Uses `react-native-view-shot`'s `captureScreen`, which snapshots the
 * whole window (so the picked component plus its surroundings land in the
 * image, same as the web capture). Returns base64 PNG with no `data:`
 * prefix, matching the `screenshot` field the middleware decodes.
 *
 * `react-native-view-shot` is an optional peer: if it isn't installed we
 * return a 1x1 transparent PNG so the comment can still be filed (the
 * server requires a non-empty screenshot string). The same transparent
 * placeholder the web widget uses on capture failure.
 */
const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export async function captureScreenshot(): Promise<string> {
  try {
    // Lazy require so a release build never pulls the native module in.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { captureScreen } = require('react-native-view-shot');
    // result: 'base64' returns the raw base64 string (no data: prefix),
    // which is exactly what FeedbackInput.screenshot wants.
    const b64: string = await captureScreen({
      format: 'png',
      quality: 0.9,
      result: 'base64',
    });
    return b64;
  } catch {
    return TRANSPARENT_PNG_BASE64;
  }
}
