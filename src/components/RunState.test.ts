import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('RunState component contract', () => {
  it('exposes accessible state semantics and a single visual vocabulary', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/RunState.tsx'), 'utf8');

    expect(source).toContain('role="status"');
    expect(source).toContain('data-run-state={tone}');
    expect(source).toContain('`status-pill-${tone}`');
    expect(source).toContain('LoaderCircle');
    expect(source).toContain('CircleCheck');
    expect(source).toContain('CircleX');
  });
});
