import { expect, test } from 'vitest';

import { resolveExecutionIntent } from './routes.js';

test('resolves a planned API response wait into a response strategy', () => {
  const intent = resolveExecutionIntent(
    {} as never,
    { action: 'wait', instruction: '等待 /api/orders 响应 4 秒' } as never,
  );

  expect(intent).toEqual({
    waitIntent: {
      timeoutMs: 4_000,
      urlPattern: '/api/orders',
      strategy: 'response',
    },
  });
});

test('preserves a named table when parsing a table assertion', () => {
  const intent = resolveExecutionIntent(
    { mode: 'aiAssert', prompt: '断言表格「订单列表」行数为 3' } as never,
  );

  expect(intent.assertionIntent).toMatchObject({
    kind: 'tableRowCount',
    expected: '3',
    tableName: '订单列表',
  });
});
