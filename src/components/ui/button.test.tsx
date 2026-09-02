import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Button } from './button.js';

describe('Button', () => {
  it('uses a neutral treatment when a primary action is disabled', () => {
    render(<Button disabled>Run</Button>);

    expect(screen.getByRole('button', { name: 'Run' })).toHaveClass(
      'disabled:bg-muted',
      'disabled:text-muted-foreground',
      'disabled:shadow-none',
    );
  });
});
