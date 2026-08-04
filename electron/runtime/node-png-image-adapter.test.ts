import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { nodePngImageAdapter } from './node-png-image-adapter.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('nodePngImageAdapter', () => {
  it('round-trips RGBA pixels without Electron nativeImage', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-png-'));
    temporaryDirectories.push(directory);
    const imagePath = path.join(directory, 'evidence.png');
    const pixels = Buffer.from([
      12, 34, 56, 255,
      78, 90, 123, 255,
    ]);

    await nodePngImageAdapter.write(imagePath, { width: 2, height: 1, pixels });
    const image = await nodePngImageAdapter.read(imagePath);

    expect(image.width).toBe(2);
    expect(image.height).toBe(1);
    expect(image.pixels).toEqual(pixels);
  });
});
