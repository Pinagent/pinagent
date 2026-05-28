// SPDX-License-Identifier: Apache-2.0
import { toBlob } from 'html-to-image';

const MAX_WIDTH = 1280;
const TARGET_MAX_BYTES = 1_000_000; // ~1MB

// Per-image placeholder when html-to-image can't fetch an image
// (cross-origin, CSP, 404). The whole-capture fallback also uses this.
const TRANSPARENT_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const TRANSPARENT_PNG_BASE64 = TRANSPARENT_PNG_DATA_URL.split(',')[1] ?? '';

function isCrossOriginImage(node: HTMLElement): boolean {
  if (node.tagName !== 'IMG') return false;
  const src = (node as HTMLImageElement).src;
  if (!src) return false;
  try {
    return new URL(src, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b) resolve(b);
      else reject(new Error('canvas.toBlob returned null'));
    }, type);
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunk to avoid "max call stack" on large arrays passed to fromCharCode.
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binary);
}

async function downscaleBlob(bitmap: ImageBitmap, targetWidth: number): Promise<Blob> {
  const ratio = targetWidth / bitmap.width;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = Math.round(bitmap.height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvasToBlob(canvas, 'image/png');
}

async function cropBlob(
  bitmap: ImageBitmap,
  rect: { x: number; y: number; w: number; h: number },
): Promise<Blob> {
  // Clamp the requested rect to the source bitmap so callers can be
  // sloppy about negative offsets or rects that extend past the page
  // (e.g. an extra picked while scrolled below the bottom of the body
  // mid-pick).
  const sx = Math.max(0, Math.min(rect.x, bitmap.width));
  const sy = Math.max(0, Math.min(rect.y, bitmap.height));
  const sw = Math.max(1, Math.min(rect.w, bitmap.width - sx));
  const sh = Math.max(1, Math.min(rect.h, bitmap.height - sy));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, sw, sh);
  return canvasToBlob(canvas, 'image/png');
}

export async function capturePageScreenshot(
  filter?: (node: HTMLElement) => boolean,
  /**
   * Document-coord rect (CSS pixels, including scroll offset) to crop
   * the capture to. Omit to keep today's full-body behavior. Used by
   * multi-anchor picks so the agent's screenshot is bounded to the
   * union of the selected elements.
   */
  cropRect?: { x: number; y: number; w: number; h: number } | null,
): Promise<string> {
  // Compose user filter with our defaults — skip the pinagent host (passed
  // in) and any cross-origin <img> nodes so html-to-image doesn't try to
  // inline them (CSP/CORS would fail the fetch).
  const composedFilter = (node: HTMLElement): boolean => {
    if (filter && !filter(node)) return false;
    if (isCrossOriginImage(node)) return false;
    return true;
  };

  let blob: Blob | null;
  try {
    // toBlob (not toPng) returns a Blob directly — no data: URL, no fetch
    // through CSP connect-src.
    blob = await toBlob(document.body, {
      pixelRatio: 1,
      cacheBust: false,
      filter: composedFilter,
      imagePlaceholder: TRANSPARENT_PNG_DATA_URL,
      skipFonts: true,
    });
  } catch (err) {
    console.warn('[pinagent] screenshot capture failed, submitting without image:', err);
    return TRANSPARENT_PNG_BASE64;
  }
  if (!blob) {
    console.warn('[pinagent] screenshot capture returned no blob, submitting without image');
    return TRANSPARENT_PNG_BASE64;
  }

  // Downscale path uses createImageBitmap + canvas.toBlob — both
  // operate on already-loaded data, no network involvement.
  try {
    let bitmap = await createImageBitmap(blob);

    // Crop first (at native resolution) so the downscale step gets a
    // tighter source and the agent sees a denser image of the picked
    // region. toBlob was called on document.body with pixelRatio:1, so
    // bitmap dims match document.body's CSS dims and the document-coord
    // rect lines up 1:1.
    if (cropRect) {
      const next = await cropBlob(bitmap, cropRect);
      bitmap.close?.();
      blob = next;
      bitmap = await createImageBitmap(blob);
    }

    if (bitmap.width > MAX_WIDTH) {
      const next = await downscaleBlob(bitmap, MAX_WIDTH);
      bitmap.close?.();
      blob = next;
      bitmap = await createImageBitmap(blob);
    }

    let width = bitmap.width;
    while (blob.size > TARGET_MAX_BYTES && width > 480) {
      width = Math.round(width * 0.8);
      const next = await downscaleBlob(bitmap, width);
      bitmap.close?.();
      blob = next;
      bitmap = await createImageBitmap(blob);
    }
    bitmap.close?.();
  } catch (err) {
    console.warn('[pinagent] downscale step failed; using full-size capture:', err);
  }

  return blobToBase64(blob);
}
