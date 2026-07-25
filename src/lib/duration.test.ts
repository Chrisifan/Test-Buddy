import { describe, expect, it } from 'vitest';

import { formatRunDuration } from './duration.js';

describe('formatRunDuration', () => {
  it.each([
    [undefined, '00:00:00'],
    [0, '00:00:00'],
    [360, '00:00:01'],
    [61_250, '00:01:02'],
    [3_661_000, '01:01:01'],
  ])('formats %s milliseconds as %s', (durationMs, expected) => {
    expect(formatRunDuration(durationMs)).toBe(expected);
  });
});
