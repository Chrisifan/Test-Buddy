import { expect, test } from 'vitest';

import { deepFreeze } from './deep-freeze.js';

test('recursively freezes nested data without replacing the source value', () => {
  const source = { metadata: { values: [{ id: 'one' }] } };
  const result = deepFreeze(source);

  expect(result).toBe(source);
  expect(Object.isFrozen(result)).toBe(true);
  expect(Object.isFrozen(result.metadata)).toBe(true);
  expect(Object.isFrozen(result.metadata.values)).toBe(true);
  expect(Object.isFrozen(result.metadata.values[0])).toBe(true);
  expect(deepFreeze('stable')).toBe('stable');
  expect(deepFreeze(result)).toBe(result);
});
