import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MetricTile } from './workbench.js';

describe('MetricTile', () => {
  it('uses the failure treatment for runtime errors', () => {
    render(
      <MetricTile label="Health" tone="error" value="Unavailable" />,
    );

    expect(screen.getByText('Health').parentElement).toHaveClass('status-pill-error');
  });
});
