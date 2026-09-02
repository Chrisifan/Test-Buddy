import { expect, test } from 'vitest';

import { loadPageComponent } from './page-registry.js';

test('loads the settings modal through the page registry', async () => {
  await expect(loadPageComponent('settings')).resolves.toMatchObject({
    default: expect.anything(),
  });
});
