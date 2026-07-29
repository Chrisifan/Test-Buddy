import { describe, expect, it } from 'vitest';

import { createInitialStudioState, hydrateStudioState } from './studio.js';

describe('studio state hydration', () => {
  it('normalizes persisted visual diff masks and discards invalid regions', () => {
    const rawState = createInitialStudioState();
    const recording = rawState.projects[0]!.recordings[0]!;
    recording.visualDiffMasks = [
      { id: 'clock', label: '实时钟', x: 95, y: -2, width: 20, height: 30 },
      { id: 'invalid', label: '无效区域', x: Number.NaN, y: 0, width: 10, height: 10 },
      { id: 'empty', label: '空区域', x: 0, y: 0, width: 0, height: 10 },
    ];

    const hydrated = hydrateStudioState(rawState);

    expect(hydrated.projects[0]!.recordings[0]!.visualDiffMasks).toEqual([
      { id: 'clock', label: '实时钟', x: 95, y: 0, width: 5, height: 30 },
    ]);
  });
});
