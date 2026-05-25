import { toPng } from 'html-to-image';

const MAX_WIDTH = 1280;
const TARGET_MAX_BYTES = 1_000_000; // ~1MB

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
  let dataUrl = await toPng(document.body, {
    pixelRatio: 1,
    cacheBust: false,
    filter,
  });

  // Downscale if very wide.
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

  return stripDataPrefix(dataUrl);
}
