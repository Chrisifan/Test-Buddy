import { expect, test } from 'vitest';

import { evaluateExplicitAssertion } from './assertions.js';

test('passes a table contains assertion from structured observation', () => {
  const result = evaluateExplicitAssertion(
    { kind: 'tableContains', expected: 'A-42', label: '表格包含' },
    undefined,
    undefined,
    {
      tables: [
        {
          index: 0,
          caption: '订单',
          rowCount: 1,
          columnCount: 1,
          headers: ['编号'],
          sampleRows: [['A-42']],
        },
      ],
    },
  );

  expect(result).toMatchObject({
    status: 'passed',
    summary: '表格包含「A-42」已通过。',
  });
});

test('keeps a table column sum assertion neutral without complete evidence', () => {
  const result = evaluateExplicitAssertion(
    {
      kind: 'tableColumnSum',
      expected: '金额 合计 42',
      label: '表格列合计',
      columnName: '金额',
    },
    undefined,
    undefined,
    {
      tables: [
        {
          index: 0,
          evidenceCompleteness: 'partial',
          caption: '订单',
          rowCount: 1,
          columnCount: 1,
          headers: ['金额'],
          sampleRows: [['42']],
        },
      ],
    },
  );

  expect(result).toMatchObject({
    status: 'neutral',
    summary: '表格列合计缺少完整表格证据，暂不判定。',
  });
});
