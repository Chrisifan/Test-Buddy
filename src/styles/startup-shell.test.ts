import { describe, expect, it } from 'vitest';

import { readLuminousPrecisionCss } from './luminous-precision.test-utils.js';

describe('startup shell layout', () => {
  it('resets legacy shell padding and grid gap for the full-bleed onboarding layout', () => {
    const styles = readLuminousPrecisionCss();
    const startupShellRule = styles.match(/\.startup-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(startupShellRule).toContain('padding: 0;');
    expect(startupShellRule).toContain('gap: 0;');
  });
});
