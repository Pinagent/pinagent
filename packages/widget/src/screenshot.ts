import { toPng } from 'html-to-image';

const MAX_WIDTH = 1280;
const TARGET_MAX_BYTES = 1_000_000; // ~1MB

// 1x1 transparent PNG — used as:
//  - imagePlaceholder for individual images we can't fetch (CSP / CORS / 404)
//  - final fallback if the whole screenshot fails
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
    return true; // can't parse → treat as foreign
  }
}

async function pngBlobFromDataUrl(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function downscale(dataUrl: string, targetWidth: number): Promise<string> {
  const img = await loadImage(dataUrl);
  const ratio = targetWidth / img.naturalWidth;
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = Math.round(img.naturalHeight * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function stripDataPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export async function capturePageScreenshot(filter?: (node: HTMLElement) => boolean): Promise<string> {
  // Compose user filter with our defaults:
  //  - exclude the pinpoint host (filter passed in)
  //  - exclude cross-origin <img> nodes so html-to-image doesn't try to
  //    inline them (CSP/CORS will block the fetch and the whole capture
  //    fails). The image shows up as blank in the screenshot but the rest
  //    of the page renders fine.
  const composedFilter = (node: HTMLElement): boolean => {
    if (filter && !filter(node)) return false;
    if (isCrossOriginImage(node)) return false;
    return true;
  };

  let dataUrl: string;
  try {
    dataUrl = await toPng(document.body, {
      pixelRatio: 1,
      cacheBust: false,
      filter: composedFilter,
      // Per-image fallback for anything else that fails to fetch.
      imagePlaceholder: TRANSPARENT_PNG_DATA_URL,
      // Webfonts often live on third-party CDNs with no CORS / blocked by CSP.
      // Skip them — the screenshot uses fallback fonts, but it still renders.
      skipFonts: true,
    });
  } catch (err) {
    // Whole capture failed (some browsers throw on tainted canvas even when
    // we filtered cross-origin images). Submit anyway with a placeholder so
    // the comment + file:line still reach the agent.
    console.warn('[pinpoint] screenshot capture failed, submitting without image:', err);
    return TRANSPARENT_PNG_BASE64;
  }

  // Downscale if very wide.
  try {
    const img = await loadImage(dataUrl);
    if (img.naturalWidth > MAX_WIDTH) {
      dataUrl = await downscale(dataUrl, MAX_WIDTH);
    }

    // If still very large, downscale more aggressively.
    let blob = await pngBlobFromDataUrl(dataUrl);
    let width = (await loadImage(dataUrl)).naturalWidth;
    while (blob.size > TARGET_MAX_BYTES && width > 480) {
      width = Math.round(width * 0.8);
      dataUrl = await downscale(dataUrl, width);
      blob = await pngBlobFromDataUrl(dataUrl);
    }
  } catch (err) {
    console.warn('[pinpoint] downscale step failed; using full-size capture:', err);
  }

  return stripDataPrefix(dataUrl);
}
