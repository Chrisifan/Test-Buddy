import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';

const brandAssets = [
  'src/assets/testbuddy-hammer-bot.png',
  'src/assets/testbuddy-hammer-bot-dark.png',
  'public/testbuddy-icon.png',
  'public/testbuddy-icon-light.png',
  'public/testbuddy-icon-dark.png',
  'resources/icons/testbuddy.png',
];

describe('brand assets', () => {
  it.each(brandAssets)('uses #0066ff in %s', (assetPath) => {
    const png = PNG.sync.read(readFileSync(path.resolve(process.cwd(), assetPath)));
    let primaryPixelCount = 0;

    for (let index = 0; index < png.data.length; index += 4) {
      const [red, green, blue, alpha] = png.data.subarray(index, index + 4);
      if (red === 0 && green === 102 && blue === 255 && alpha === 255) {
        primaryPixelCount += 1;
      }
    }

    expect(primaryPixelCount).toBeGreaterThan(0);
  });
});
