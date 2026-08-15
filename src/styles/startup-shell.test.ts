import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('startup shell layout', () => {
  it('resets legacy shell padding and grid gap for the full-bleed onboarding layout', () => {
    const styles = readFileSync(resolve(process.cwd(), 'src/styles/luminous-precision.css'), 'utf8');
    const startupShellRule = styles.match(/\.startup-shell\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';

    expect(startupShellRule).toContain('padding: 0;');
    expect(startupShellRule).toContain('gap: 0;');
  });
});
