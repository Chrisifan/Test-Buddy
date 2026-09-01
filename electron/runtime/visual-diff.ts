import type { VisualDiffMask } from '../../shared/studio.js';

export interface VisualDiffImage {
  width: number;
  height: number;
  pixels: Buffer;
}

export interface VisualDiffImageAdapter {
  read(imagePath: string): Promise<VisualDiffImage>;
  write(imagePath: string, image: VisualDiffImage): Promise<void>;
}

export interface VisualDiffRequest {
  baselinePath: string;
  actualPath: string;
  diffPath: string;
  differenceThreshold?: number;
  ignoredRegions?: VisualDiffMask[];
}

export interface VisualDiffResult {
  status: 'passed' | 'failed' | 'neutral';
  message: string;
  changedPixels: number;
  totalPixels: number;
  maskedPixels: number;
  differenceRatio: number;
  diffPath?: string;
}

const getMaskedPixelOffsets = (
  masks: VisualDiffMask[] | undefined,
  width: number,
  height: number,
): Set<number> => {
  const maskedOffsets = new Set<number>();
  (masks ?? []).forEach((mask) => {
    const x = Math.min(100, Math.max(0, mask.x));
    const y = Math.min(100, Math.max(0, mask.y));
    const right = Math.min(100, Math.max(x, x + mask.width));
    const bottom = Math.min(100, Math.max(y, y + mask.height));
    const startX = Math.floor((x / 100) * width);
    const startY = Math.floor((y / 100) * height);
    const endX = Math.ceil((right / 100) * width);
    const endY = Math.ceil((bottom / 100) * height);
    for (let pixelY = startY; pixelY < endY; pixelY += 1) {
      for (let pixelX = startX; pixelX < endX; pixelX += 1) {
        maskedOffsets.add((pixelY * width + pixelX) * 4);
      }
    }
  });
  return maskedOffsets;
};

const hasValidPixelBuffer = (image: VisualDiffImage): boolean => {
  return image.width > 0 && image.height > 0 && image.pixels.length === image.width * image.height * 4;
};

export class PixelVisualDiffService {
  constructor(private readonly imageAdapter: VisualDiffImageAdapter) {}

  async compare(request: VisualDiffRequest): Promise<VisualDiffResult> {
    let baseline: VisualDiffImage;
    let actual: VisualDiffImage;
    try {
      [baseline, actual] = await Promise.all([
        this.imageAdapter.read(request.baselinePath),
        this.imageAdapter.read(request.actualPath),
      ]);
    } catch (error) {
      return {
        status: 'neutral',
        message: `无法读取视觉对比截图：${(error as Error).message}`,
        changedPixels: 0,
        totalPixels: 0,
        maskedPixels: 0,
        differenceRatio: 0,
      };
    }

    if (!hasValidPixelBuffer(baseline) || !hasValidPixelBuffer(actual)) {
      return {
        status: 'neutral',
        message: '视觉对比截图格式无效，未生成差异结论。',
        changedPixels: 0,
        totalPixels: 0,
        maskedPixels: 0,
        differenceRatio: 0,
      };
    }
    if (baseline.width !== actual.width || baseline.height !== actual.height) {
      return {
        status: 'neutral',
        message: `视觉对比截图尺寸不一致：基线 ${baseline.width}x${baseline.height}，实际 ${actual.width}x${actual.height}。`,
        changedPixels: 0,
        totalPixels: 0,
        maskedPixels: 0,
        differenceRatio: 0,
      };
    }

    const allPixels = baseline.width * baseline.height;
    const maskedOffsets = getMaskedPixelOffsets(request.ignoredRegions, baseline.width, baseline.height);
    const maskedPixels = maskedOffsets.size;
    const totalPixels = allPixels - maskedPixels;
    if (!totalPixels) {
      return {
        status: 'neutral',
        message: '视觉遮罩覆盖了全部截图，未留下可比较像素。',
        changedPixels: 0,
        totalPixels: 0,
        maskedPixels,
        differenceRatio: 0,
      };
    }

    const diffPixels = Buffer.alloc(allPixels * 4);
    let changedPixels = 0;
    for (let offset = 0; offset < baseline.pixels.length; offset += 4) {
      if (maskedOffsets.has(offset)) {
        continue;
      }
      const hasChanged =
        baseline.pixels[offset] !== actual.pixels[offset] ||
        baseline.pixels[offset + 1] !== actual.pixels[offset + 1] ||
        baseline.pixels[offset + 2] !== actual.pixels[offset + 2] ||
        baseline.pixels[offset + 3] !== actual.pixels[offset + 3];
      if (!hasChanged) {
        continue;
      }

      changedPixels += 1;
      diffPixels[offset] = 255;
      diffPixels[offset + 1] = 43;
      diffPixels[offset + 2] = 43;
      diffPixels[offset + 3] = 255;
    }

    try {
      await this.imageAdapter.write(request.diffPath, {
        width: baseline.width,
        height: baseline.height,
        pixels: diffPixels,
      });
    } catch (error) {
      return {
        status: 'neutral',
        message: `无法写入视觉差异图：${(error as Error).message}`,
        changedPixels: 0,
        totalPixels: 0,
        maskedPixels: 0,
        differenceRatio: 0,
      };
    }

    const differenceRatio = changedPixels / totalPixels;
    const differenceThreshold = Math.min(1, Math.max(0, request.differenceThreshold ?? 0));
    const passed = differenceRatio <= differenceThreshold;
    return {
      status: passed ? 'passed' : 'failed',
      message:
        changedPixels === 0
          ? `视觉基线对比通过，未发现像素差异${maskedPixels ? `；已忽略 ${maskedPixels} 个遮罩像素。` : '。'}`
          : passed
            ? `视觉基线对比通过，${changedPixels}/${totalPixels} 个可比较像素变化未超过阈值 ${(differenceThreshold * 100).toFixed(2)}%。`
          : `视觉基线对比发现 ${changedPixels}/${totalPixels} 个可比较像素变化，超过阈值 ${(differenceThreshold * 100).toFixed(2)}%。`,
      changedPixels,
      totalPixels,
      maskedPixels,
      differenceRatio,
      diffPath: request.diffPath,
    };
  }
}
