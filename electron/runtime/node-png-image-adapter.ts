import fs from 'node:fs/promises';
import path from 'node:path';

import { PNG } from 'pngjs';

import type { VisualDiffImage, VisualDiffImageAdapter } from './visual-diff.js';

export const nodePngImageAdapter: VisualDiffImageAdapter = {
  async read(imagePath: string): Promise<VisualDiffImage> {
    const png = PNG.sync.read(await fs.readFile(imagePath));
    return {
      width: png.width,
      height: png.height,
      pixels: Buffer.from(png.data),
    };
  },

  async write(imagePath: string, image: VisualDiffImage): Promise<void> {
    await fs.mkdir(path.dirname(imagePath), { recursive: true });
    const png = new PNG({ width: image.width, height: image.height });
    image.pixels.copy(png.data);
    await fs.writeFile(imagePath, PNG.sync.write(png));
  },
};
