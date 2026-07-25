import fs from 'node:fs/promises';
import path from 'node:path';

import { nativeImage } from 'electron';

import type { VisualDiffImage, VisualDiffImageAdapter } from './visual-diff.js';

export const electronNativeImageAdapter: VisualDiffImageAdapter = {
  async read(imagePath: string): Promise<VisualDiffImage> {
    const image = nativeImage.createFromPath(imagePath);
    if (image.isEmpty()) {
      throw new Error(`无法解码图像：${imagePath}`);
    }

    const { width, height } = image.getSize();
    return { width, height, pixels: image.toBitmap() };
  },

  async write(imagePath: string, image: VisualDiffImage): Promise<void> {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    const native = nativeImage.createFromBitmap(image.pixels, {
      width: image.width,
      height: image.height,
      scaleFactor: 1,
    });
    await fs.writeFile(imagePath, native.toPNG());
  },
};
