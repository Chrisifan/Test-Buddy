import { describe, expect, it } from 'vitest';

import { createMainWindowOptions } from './window-options.js';

describe('main window options', () => {
  it('uses native transparent vibrancy while retaining macOS window controls', () => {
    const options = createMainWindowOptions({
      icon: undefined,
      preloadPath: '/application/preload.cjs',
      platform: 'darwin',
    });

    expect(options).toMatchObject({
      backgroundColor: '#00000000',
      titleBarStyle: 'hidden',
      transparent: true,
      vibrancy: 'under-window',
      visualEffectState: 'active',
    });
  });
});
