import { describe, expect, it } from 'vitest';

import {
  PixelVisualDiffService,
  type VisualDiffImage,
  type VisualDiffImageAdapter,
} from './visual-diff.js';

class MemoryImageAdapter implements VisualDiffImageAdapter {
  readonly images = new Map<string, VisualDiffImage>();

  async read(imagePath: string): Promise<VisualDiffImage> {
    const image = this.images.get(imagePath);
    if (!image) {
      throw new Error(`missing image: ${imagePath}`);
    }
    return image;
  }

  async write(imagePath: string, image: VisualDiffImage): Promise<void> {
    this.images.set(imagePath, image);
  }
}

describe('PixelVisualDiffService', () => {
  it('passes identical screenshots and persists a transparent diff image', async () => {
    const adapter = new MemoryImageAdapter();
    const pixels = Buffer.from([20, 30, 40, 255, 80, 90, 100, 255]);
    adapter.images.set('/baseline.png', { width: 2, height: 1, pixels });
    adapter.images.set('/actual.png', { width: 2, height: 1, pixels: Buffer.from(pixels) });

    const result = await new PixelVisualDiffService(adapter).compare({
      baselinePath: '/baseline.png',
      actualPath: '/actual.png',
      diffPath: '/diff.png',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'passed',
        changedPixels: 0,
        totalPixels: 2,
        differenceRatio: 0,
        diffPath: '/diff.png',
      }),
    );
    expect(adapter.images.get('/diff.png')?.pixels).toEqual(Buffer.alloc(8));
  });

  it('fails changed screenshots and highlights changed pixels in the diff image', async () => {
    const adapter = new MemoryImageAdapter();
    adapter.images.set('/baseline.png', {
      width: 2,
      height: 1,
      pixels: Buffer.from([20, 30, 40, 255, 80, 90, 100, 255]),
    });
    adapter.images.set('/actual.png', {
      width: 2,
      height: 1,
      pixels: Buffer.from([20, 30, 40, 255, 1, 2, 3, 255]),
    });

    const result = await new PixelVisualDiffService(adapter).compare({
      baselinePath: '/baseline.png',
      actualPath: '/actual.png',
      diffPath: '/diff.png',
    });

    expect(result).toEqual(
      expect.objectContaining({
        status: 'failed',
        changedPixels: 1,
        totalPixels: 2,
        differenceRatio: 0.5,
      }),
    );
    expect(adapter.images.get('/diff.png')?.pixels).toEqual(
      Buffer.from([0, 0, 0, 0, 255, 43, 43, 255]),
    );
  });

  it('passes a changed screenshot when its difference ratio is within the configured threshold', async () => {
    const adapter = new MemoryImageAdapter();
    adapter.images.set('/baseline.png', {
      width: 2,
      height: 1,
      pixels: Buffer.from([20, 30, 40, 255, 80, 90, 100, 255]),
    });
    adapter.images.set('/actual.png', {
      width: 2,
      height: 1,
      pixels: Buffer.from([20, 30, 40, 255, 1, 2, 3, 255]),
    });

    const result = await new PixelVisualDiffService(adapter).compare({
      baselinePath: '/baseline.png',
      actualPath: '/actual.png',
      diffPath: '/diff.png',
      differenceThreshold: 0.5,
    });

    expect(result).toEqual(
      expect.objectContaining({ status: 'passed', changedPixels: 1, differenceRatio: 0.5 }),
    );
  });

  it('ignores changed pixels inside configured dynamic regions', async () => {
    const adapter = new MemoryImageAdapter();
    adapter.images.set('/baseline.png', {
      width: 2,
      height: 1,
      pixels: Buffer.from([20, 30, 40, 255, 80, 90, 100, 255]),
    });
    adapter.images.set('/actual.png', {
      width: 2,
      height: 1,
      pixels: Buffer.from([1, 2, 3, 255, 80, 90, 100, 255]),
    });

    const result = await new PixelVisualDiffService(adapter).compare({
      baselinePath: '/baseline.png',
      actualPath: '/actual.png',
      diffPath: '/diff.png',
      ignoredRegions: [{ id: 'clock', label: '实时时钟', x: 0, y: 0, width: 50, height: 100 }],
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'passed',
      changedPixels: 0,
      totalPixels: 1,
      maskedPixels: 1,
      differenceRatio: 0,
    }));
    expect(adapter.images.get('/diff.png')?.pixels).toEqual(Buffer.alloc(8));
  });

  it('keeps the comparison neutral when masks cover the entire screenshot', async () => {
    const adapter = new MemoryImageAdapter();
    const pixels = Buffer.from([20, 30, 40, 255]);
    adapter.images.set('/baseline.png', { width: 1, height: 1, pixels });
    adapter.images.set('/actual.png', { width: 1, height: 1, pixels: Buffer.from([1, 2, 3, 255]) });

    const result = await new PixelVisualDiffService(adapter).compare({
      baselinePath: '/baseline.png',
      actualPath: '/actual.png',
      diffPath: '/diff.png',
      ignoredRegions: [{ id: 'all', label: '动态内容', x: 0, y: 0, width: 100, height: 100 }],
    });

    expect(result).toEqual(expect.objectContaining({ status: 'neutral', totalPixels: 0, maskedPixels: 1 }));
    expect(adapter.images.has('/diff.png')).toBe(false);
  });

  it('keeps a dimension mismatch neutral without producing a misleading diff', async () => {
    const adapter = new MemoryImageAdapter();
    adapter.images.set('/baseline.png', { width: 1, height: 1, pixels: Buffer.alloc(4) });
    adapter.images.set('/actual.png', { width: 2, height: 1, pixels: Buffer.alloc(8) });

    const result = await new PixelVisualDiffService(adapter).compare({
      baselinePath: '/baseline.png',
      actualPath: '/actual.png',
      diffPath: '/diff.png',
    });

    expect(result).toEqual(expect.objectContaining({ status: 'neutral', changedPixels: 0, totalPixels: 0 }));
    expect(adapter.images.has('/diff.png')).toBe(false);
  });
});
