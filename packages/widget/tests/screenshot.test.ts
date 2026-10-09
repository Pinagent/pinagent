// SPDX-License-Identifier: Apache-2.0
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toSvg = vi.fn<() => Promise<string>>();
vi.mock('html-to-image', () => ({ toSvg: (...args: unknown[]) => toSvg(...(args as [])) }));

const { capturePageScreenshot } = await import('../src/screenshot');

const TRANSPARENT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// happy-dom doesn't decode images or rasterize canvases, so stand in for
// both: the "rendered" image reports a fixed size and the canvas encodes to
// a known blob.
let imageSize = { w: 800, h: 600 };
let canvasSizes: Array<{ w: number; h: number }> = [];

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = 'auto';
  naturalWidth = 0;
  naturalHeight = 0;
  decode = () => Promise.resolve();
  set src(_url: string) {
    this.naturalWidth = imageSize.w;
    this.naturalHeight = imageSize.h;
    queueMicrotask(() => this.onload?.());
  }
}

beforeEach(() => {
  imageSize = { w: 800, h: 600 };
  canvasSizes = [];
  toSvg.mockReset();
  vi.stubGlobal('Image', FakeImage);
  // A hidden tab never runs animation frames.
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    canvasSizes.push({ w: this.width, h: this.height });
    return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => {
    cb(new Blob(['png!'], { type: 'image/png' }));
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('capturePageScreenshot', () => {
  it('finishes without waiting for an animation frame', async () => {
    toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,<svg/>');

    const base64 = await capturePageScreenshot();

    expect(atob(base64)).toBe('png!');
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    expect(canvasSizes[0]).toEqual({ w: 800, h: 600 });
  });

  it('submits without an image when the capture never settles', async () => {
    vi.useFakeTimers();
    toSvg.mockReturnValue(new Promise(() => {}));

    const pending = capturePageScreenshot();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(pending).resolves.toBe(TRANSPARENT_PNG_BASE64);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('took over 10s'));
  });

  it('submits without an image when the capture fails', async () => {
    toSvg.mockRejectedValue(new Error('boom'));

    await expect(capturePageScreenshot()).resolves.toBe(TRANSPARENT_PNG_BASE64);
  });

  it('keeps a very tall page within the browser canvas limit', async () => {
    imageSize = { w: 1000, h: 40_000 };
    toSvg.mockResolvedValue('data:image/svg+xml;charset=utf-8,<svg/>');

    await capturePageScreenshot();

    expect(canvasSizes[0]).toEqual({ w: 409, h: 16_384 });
  });
});
