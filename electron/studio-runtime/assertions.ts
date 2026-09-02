import type { AgentDomInspection, AgentObservation, AgentRunStatus } from '../../shared/agent.js';
import type { BrowserSessionState, ExplicitTestAssertion } from '../../shared/studio.js';
import { formatChartTrend } from './routes.js';
import type { ExplicitAssertionIntent } from './routes.js';

export interface AssertionEvaluation {
  status: AgentRunStatus;
  summary: string;
  evidence: string;
  failureReason?: string;
}

export const evaluateExplicitAssertion = (
  assertion: ExplicitAssertionIntent,
  session: BrowserSessionState | undefined,
  pageText?: string,
  observation?: Partial<Pick<AgentObservation, 'tables' | 'charts'>>,
  domInspection?: AgentDomInspection,
): AssertionEvaluation => {
  if (
    assertion.kind === 'domSelectorExists' ||
    assertion.kind === 'domSelectorVisible' ||
    assertion.kind === 'domSelectorTextContains' ||
    assertion.kind === 'domSelectorAttributeEquals'
  ) {
    return evaluateDomAssertion(assertion, domInspection);
  }
  const tables = selectAssertionTables(observation?.tables ?? [], assertion.tableName);
  const charts = selectAssertionCharts(observation?.charts ?? [], assertion.chartName);
  if (assertion.kind === 'tableRowCount' || assertion.kind === 'tableColumnCount') {
    return evaluateTableCountAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableCellEquals') {
    return evaluateTableCellAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableColumnContains') {
    return evaluateTableColumnContainsAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableColumnSum') {
    return evaluateTableColumnSumAssertion(assertion, tables);
  }
  if (assertion.kind === 'tableSort') {
    return evaluateTableSortAssertion(assertion, tables);
  }
  if (
    assertion.kind === 'tableFilter' ||
    assertion.kind === 'tableCurrentPage' ||
    assertion.kind === 'tableTotalPages' ||
    assertion.kind === 'tableTotalItems' ||
    assertion.kind === 'tablePageSize' ||
    assertion.kind === 'tableAggregateEquals'
  ) {
    return evaluateTableStateAssertion(assertion, tables);
  }
  if (assertion.kind === 'chartCount') {
    return evaluateChartCountAssertion(assertion, charts);
  }
  if (assertion.kind === 'chartRendered') {
    return evaluateChartRenderedAssertion(assertion, charts);
  }
  if (assertion.kind === 'chartTitleEquals' || assertion.kind === 'chartLegendContains') {
    return evaluateChartFieldAssertion(assertion, charts);
  }
  if (
    assertion.kind === 'chartTooltipContains' ||
    assertion.kind === 'chartDataContains' ||
    assertion.kind === 'chartSeriesContains' ||
    assertion.kind === 'chartDataPointEquals' ||
    assertion.kind === 'chartSeriesDataPointEquals' ||
    assertion.kind === 'chartSeriesTrend' ||
    assertion.kind === 'chartTrend'
  ) {
    return evaluateChartEvidenceAssertion(assertion, charts);
  }

  const actual =
    assertion.kind === 'urlContains'
      ? session?.currentUrl ?? ''
      : assertion.kind === 'titleContains'
        ? session?.pageTitle ?? ''
        : assertion.kind === 'tableContains'
          ? summarizeTables(tables)
          : assertion.kind === 'chartContains'
            ? summarizeCharts(charts)
          : pageText ?? '';
  const passed = actual.includes(assertion.expected);
  const targetLabel =
    assertion.kind === 'urlContains'
      ? '当前 URL'
      : assertion.kind === 'titleContains'
        ? '页面标题'
        : assertion.kind === 'tableContains'
          ? '表格内容'
          : assertion.kind === 'chartContains'
            ? '图表内容'
          : '页面文本';
  const evidence =
    assertion.kind === 'pageContains'
      ? `${targetLabel}长度 ${actual.length}，期望片段：${assertion.expected}`
      : assertion.kind === 'tableContains'
        ? `${targetLabel}：${actual || '未观察到表格'}；期望包含：${assertion.expected}`
        : assertion.kind === 'chartContains'
          ? `${targetLabel}：${actual || '未观察到图表'}；期望包含：${assertion.expected}`
      : `${targetLabel}：${actual || '空'}；期望包含：${assertion.expected}`;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${targetLabel}不包含「${assertion.expected}」。`,
  };
};

export const toExplicitAssertionIntent = (assertion: ExplicitTestAssertion): ExplicitAssertionIntent => {
  switch (assertion.kind) {
    case 'urlContains':
      return { kind: 'urlContains', expected: assertion.expected, label: '当前 URL 包含' };
    case 'titleContains':
      return { kind: 'titleContains', expected: assertion.expected, label: '页面标题包含' };
    case 'pageContains':
      return { kind: 'pageContains', expected: assertion.expected, label: '页面文本包含' };
    case 'locatorVisible':
      return {
        kind: 'domSelectorVisible',
        expected: assertion.locator.selector,
        label: '元素可见',
        domSelector: assertion.locator.selector,
      };
    case 'locatorTextContains':
      return {
        kind: 'domSelectorTextContains',
        expected: assertion.expected,
        label: '元素文本包含',
        domSelector: assertion.locator.selector,
      };
  }
};


const evidenceCompletenessLabel = (value: 'complete' | 'partial' | 'unknown' | undefined): string => {
  return value === 'complete' ? '完整' : value === 'partial' ? '局部/虚拟化' : '未知';
};

const requireCompleteTableEvidence = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): { tables: NonNullable<AgentObservation['tables']> } | { pending: AssertionEvaluation } => {
  const completeTables = tables.filter((table) => table.evidenceCompleteness === 'complete');
  if (completeTables.length) {
    return { tables: completeTables };
  }
  const evidence = tables.length
    ? tables.map((table) => `${table.caption || `表格 #${table.index}`}：证据${evidenceCompletenessLabel(table.evidenceCompleteness)}`).join('；')
    : '未观察到表格';
  return {
    pending: {
      status: 'neutral',
      summary: `${assertion.label}缺少完整表格证据，暂不判定。`,
      evidence,
    },
  };
};

const requireCompleteChartEvidence = (
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): { charts: NonNullable<AgentObservation['charts']> } | { pending: AssertionEvaluation } => {
  const completeCharts = charts.filter((chart) => chart.evidenceCompleteness === 'complete');
  if (completeCharts.length) {
    return { charts: completeCharts };
  }
  const evidence = charts.length
    ? charts.map((chart) => `${chart.title || `图表 #${chart.index}`}：证据${evidenceCompletenessLabel(chart.evidenceCompleteness)}`).join('；')
    : '未观察到图表';
  return {
    pending: {
      status: 'neutral',
      summary: `${assertion.label}缺少完整图表证据，暂不判定。`,
      evidence,
    },
  };
};

const evaluateChartCountAssertion = (
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation => {
  const expectedCount = Number.parseInt(assertion.expected, 10);
  const chartTitles = charts.map((chart) => chart.title || `图表 #${chart.index}`).join('、');
  const evidence = `实际观察到 ${charts.length} 个图表${chartTitles ? `：${chartTitles}` : ''}`;
  const passed = Number.isFinite(expectedCount) ? charts.length === expectedCount : false;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
  };
};

const evaluateDomAssertion = (
  assertion: ExplicitAssertionIntent,
  inspection: AgentDomInspection | undefined,
): AssertionEvaluation => {
  const selector = assertion.domSelector ?? assertion.expected;
  const evidence = inspection
    ? `${inspection.selector}：${inspection.found ? (inspection.visible ? '已找到且可见' : '已找到但不可见') : '未找到'}${inspection.text ? `；文本：${inspection.text}` : ''}${inspection.attribute ? `；属性 ${inspection.attribute.name}：${inspection.attribute.value ?? '未设置'}` : ''}`
    : `未连接 DOM 检查器，无法检查 ${selector}`;
  const passed =
    assertion.kind === 'domSelectorExists'
      ? inspection?.found === true
      : assertion.kind === 'domSelectorVisible'
        ? inspection?.visible === true
        : assertion.kind === 'domSelectorAttributeEquals'
          ? inspection?.found === true && inspection.attribute?.name === assertion.domAttributeName && inspection.attribute?.value === assertion.expected
          : inspection?.found === true && Boolean(inspection.text?.includes(assertion.expected));
  if (passed) {
    return { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence };
  }

  const failureReason =
    assertion.kind === 'domSelectorExists'
      ? `未找到 DOM selector「${selector}」。`
      : assertion.kind === 'domSelectorVisible'
        ? `DOM selector 不可见「${selector}」。`
        : assertion.kind === 'domSelectorAttributeEquals'
          ? `DOM 属性「${assertion.domAttributeName ?? ''}」不等于「${assertion.expected}」。`
        : `DOM 文本不包含「${assertion.expected}」。`;
  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason,
  };
};

const evaluateChartFieldAssertion = (
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation => {
  const isTitleAssertion = assertion.kind === 'chartTitleEquals';
  const values = charts.flatMap((chart) => (isTitleAssertion ? [chart.title].filter(Boolean) : chart.legends ?? []));
  const evidence = isTitleAssertion
    ? `图表标题：${values.join(' / ') || '未观察到标题'}`
    : `图表图例：${values.join(' / ') || '未观察到图例'}`;
  const passed = isTitleAssertion ? values.some((value) => value === assertion.expected) : values.includes(assertion.expected);

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}${isTitleAssertion ? '不等于' : '不包含'}「${assertion.expected}」。`,
  };
};

const evaluateChartRenderedAssertion = (
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation => {
  const evidence = charts.length
    ? charts
        .map((chart) => {
          const size = chart.width !== undefined && chart.height !== undefined ? `${chart.width}x${chart.height}` : '尺寸未记录';
          return `${chart.title || `图表 #${chart.index}`}：${chart.rendered ? '已渲染' : '未渲染'} ${size}`;
        })
        .join('；')
    : '未观察到图表';
  const passed = charts.some((chart) => chart.rendered === true);

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: '未观察到已渲染图表。',
  };
};

const evaluateChartEvidenceAssertion = (
  assertion: ExplicitAssertionIntent,
  charts: NonNullable<AgentObservation['charts']>,
): AssertionEvaluation => {
  if (assertion.kind === 'chartSeriesTrend' || assertion.kind === 'chartTrend') {
    const completeness = requireCompleteChartEvidence(assertion, charts);
    if ('pending' in completeness) {
      return completeness.pending;
    }
    charts = completeness.charts;
  }
  const chartLabel = (chart: NonNullable<AgentObservation['charts']>[number]) => chart.title || `图表 #${chart.index}`;
  const formatDataPoint = (point: { series?: string; label?: string; value: number }) =>
    `${point.series ? `${point.series} / ` : ''}${point.label ? `${point.label} = ` : ''}${formatNumber(point.value)}`;
  const formatDataEvidence = () =>
    charts.length
      ? charts
          .map((chart) => `${chartLabel(chart)}：${(chart.dataPoints ?? []).map(formatDataPoint).join(' / ') || '未观察到结构化数据点'}`)
          .join('；')
      : '未观察到图表';
  const formatSeriesTrendEvidence = () =>
    charts.length
      ? charts
          .map(
            (chart) =>
              `${chartLabel(chart)}：${(chart.seriesTrends ?? [])
                .map((seriesTrend) => `${seriesTrend.series} ${formatChartTrend(seriesTrend.trend)}`)
                .join(' / ') || '未观察到系列趋势'}`,
          )
          .join('；')
      : '未观察到图表';
  const formatSeriesEvidence = () =>
    charts.length
      ? charts
          .map((chart) => {
            const seriesNames = Array.from(
              new Set([
                ...(chart.dataPoints ?? []).map((point) => point.series).filter((series): series is string => Boolean(series)),
                ...(chart.seriesTrends ?? []).map((seriesTrend) => seriesTrend.series),
              ]),
            );
            return `${chartLabel(chart)}：${seriesNames.join(' / ') || '未观察到结构化系列'}`;
          })
          .join('；')
      : '未观察到图表';
  if (assertion.kind === 'chartTooltipContains') {
    const evidence = charts.length
      ? charts.map((chart) => `${chartLabel(chart)}：${chart.tooltip || '未观察到可见提示'}`).join('；')
      : '未观察到图表';
    const passed = charts.some((chart) => chart.tooltip?.includes(assertion.expected));
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不包含「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'chartDataContains') {
    const evidence = formatDataEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some(
        (point) => point.series === assertion.expected || point.label === assertion.expected || formatNumber(point.value) === assertion.expected,
      ),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不包含「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'chartDataPointEquals') {
    const pointLabel = assertion.chartDataPointLabel ?? '';
    const expectedValue = assertion.expected.replace(`${pointLabel} = `, '');
    const evidence = formatDataEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some((point) => point.label === pointLabel && formatNumber(point.value) === expectedValue),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
        failureReason: `图表数据点「${pointLabel}」不等于「${expectedValue}」。`,
      };
  }

  if (assertion.kind === 'chartSeriesContains') {
    const evidence = formatSeriesEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some((point) => point.series === assertion.expected) ||
      (chart.seriesTrends ?? []).some((seriesTrend) => seriesTrend.series === assertion.expected),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不包含「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'chartSeriesDataPointEquals') {
    const seriesName = assertion.chartSeriesName ?? '';
    const pointLabel = assertion.chartDataPointLabel ?? '';
    const expectedValue = assertion.expected.replace(`${seriesName} / ${pointLabel} = `, '');
    const evidence = formatDataEvidence();
    const passed = charts.some((chart) =>
      (chart.dataPoints ?? []).some(
        (point) => point.series === seriesName && point.label === pointLabel && formatNumber(point.value) === expectedValue,
      ),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `图表系列「${seriesName}」数据点「${pointLabel}」不等于「${expectedValue}」。`,
      };
  }

  if (assertion.kind === 'chartSeriesTrend') {
    const seriesName = assertion.chartSeriesName ?? '';
    const trend = assertion.chartTrend;
    const evidence = formatSeriesTrendEvidence();
    const passed = trend !== undefined && charts.some((chart) =>
      (chart.seriesTrends ?? []).some((seriesTrend) => seriesTrend.series === seriesName && seriesTrend.trend === trend),
    );
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `图表系列「${seriesName}」趋势不匹配「${assertion.expected.replace(`${seriesName} `, '')}」。`,
        };
  }

  const trend = assertion.chartTrend;
  const evidence = charts.length
    ? charts.map((chart) => `${chartLabel(chart)}：${chart.trend ? formatChartTrend(chart.trend) : '未观察到趋势'}`).join('；')
    : '未观察到图表';
  const passed = trend !== undefined && charts.some((chart) => chart.trend === trend);
  return passed
    ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
    : {
        status: 'failed',
        summary: `${assertion.label}「${assertion.expected}」未通过。`,
        evidence,
        failureReason: `${assertion.label}不匹配「${assertion.expected}」。`,
      };
};

const evaluateTableCellAssertion = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation => {
  const rowIndex = assertion.rowIndex ?? 0;
  const columnIndex = assertion.columnIndex ?? 0;
  const tableWithCell = tables.find((table) => table.sampleRows[rowIndex - 1]?.[columnIndex - 1] !== undefined);
  const actual = tableWithCell?.sampleRows[rowIndex - 1]?.[columnIndex - 1] ?? '';
  const tableName = tableWithCell?.caption || (tableWithCell ? `表格 #${tableWithCell.index}` : '未观察到匹配表格');
  const evidence = actual
    ? `${tableName} 第 ${rowIndex} 行第 ${columnIndex} 列：${actual}`
    : `${tableName} 第 ${rowIndex} 行第 ${columnIndex} 列未在当前样例行中观察到`;
  const passed = actual === assertion.expected;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
  };
};

const evaluateTableColumnContainsAssertion = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation => {
  const columnName = assertion.columnName ?? '';
  const expectedValue = assertion.expected.replace(`${columnName} 包含 `, '');
  const columnEvidence = tables.flatMap((table) => {
    const columnIndex = table.headers.findIndex((header) => header === columnName);
    if (columnIndex < 0) {
      return [];
    }

    const values = table.sampleRows.map((row) => row[columnIndex]).filter((value): value is string => Boolean(value));
    return [`${table.caption || `表格 #${table.index}`}：${columnName} = ${values.join(' / ')}`];
  });
  const evidence = columnEvidence.length ? columnEvidence.join('；') : `未观察到表格列：${columnName}`;
  const passed = tables.some((table) => {
    const columnIndex = table.headers.findIndex((header) => header === columnName);
    if (columnIndex < 0) {
      return false;
    }
    return table.sampleRows.some((row) => row[columnIndex] === expectedValue);
  });

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `表格列不包含「${expectedValue}」。`,
  };
};

const evaluateTableColumnSumAssertion = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation => {
  const completeness = requireCompleteTableEvidence(assertion, tables);
  if ('pending' in completeness) {
    return completeness.pending;
  }
  tables = completeness.tables;
  const columnName = assertion.columnName ?? '';
  const expectedText = assertion.expected.replace(`${columnName} 合计 `, '');
  const expectedSum = Number.parseFloat(expectedText);
  const sums = tables.flatMap((table) =>
    (table.aggregates ?? []).flatMap((aggregate) => {
      if (aggregate.label !== columnName) {
        return [];
      }
      const sum = parseNumericCell(aggregate.value);
      return sum === undefined
        ? []
        : [{ label: `${table.caption || `表格 #${table.index}`}：${columnName} 合计 ${aggregate.value}`, sum }];
    }),
  );
  const evidence = sums.length
    ? sums.map((item) => item.label).join('；')
    : `未观察到完整表格的显式合计：${columnName}`;
  const passed = Number.isFinite(expectedSum) && sums.some((item) => Math.abs(item.sum - expectedSum) < 0.000001);

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${expectedText}」。`,
  };
};

const parseNumericCell = (value: string): number | undefined => {
  const normalized = value.replace(/,/g, '').trim();
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return undefined;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const formatNumber = (value: number): string => {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
};

const evaluateTableSortAssertion = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation => {
  const completeness = requireCompleteTableEvidence(assertion, tables);
  if ('pending' in completeness) {
    return completeness.pending;
  }
  tables = completeness.tables;
  const sortColumn = assertion.sortColumn ?? '';
  const sortDirection = assertion.sortDirection;
  const sortEvidence = tables.flatMap((table) =>
    (table.sortStates ?? []).map((state) => `${table.caption || `表格 #${table.index}`}：${state.column} ${state.direction}`),
  );
  const evidence = sortEvidence.length
    ? sortEvidence.join('；')
    : '未观察到表格排序状态';
  if (!sortEvidence.length) {
    return {
      status: 'neutral',
      summary: `${assertion.label}缺少显式排序状态，暂不判定。`,
      evidence,
    };
  }
  const explicitPassed = tables.some((table) =>
    (table.sortStates ?? []).some((state) => state.column === sortColumn && state.direction === sortDirection),
  );
  const passed = explicitPassed;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不匹配「${assertion.expected}」。`,
  };
};

const evaluateTableCountAssertion = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation => {
  const expectedCount = Number.parseInt(assertion.expected, 10);
  const isRowCount = assertion.kind === 'tableRowCount';
  if (isRowCount) {
    const completeness = requireCompleteTableEvidence(assertion, tables);
    if ('pending' in completeness) {
      return completeness.pending;
    }
    tables = completeness.tables;
  }
  const evidence = tables.length
    ? tables
        .map((table) => `${table.caption || `表格 #${table.index}`}：${isRowCount ? table.rowCount : table.columnCount} ${isRowCount ? '行' : '列'}`)
        .join('；')
    : '未观察到表格';
  const passed = Number.isFinite(expectedCount)
    ? tables.some((table) => (isRowCount ? table.rowCount : table.columnCount) === expectedCount)
    : false;

  if (passed) {
    return {
      status: 'passed',
      summary: `${assertion.label}「${assertion.expected}」已通过。`,
      evidence,
    };
  }

  return {
    status: 'failed',
    summary: `${assertion.label}「${assertion.expected}」未通过。`,
    evidence,
    failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
  };
};

const evaluateTableStateAssertion = (
  assertion: ExplicitAssertionIntent,
  tables: NonNullable<AgentObservation['tables']>,
): AssertionEvaluation => {
  const tableLabel = (table: NonNullable<AgentObservation['tables']>[number]) => table.caption || `表格 #${table.index}`;
  const paginationKey =
    assertion.kind === 'tableCurrentPage'
      ? 'currentPage'
      : assertion.kind === 'tableTotalPages'
        ? 'totalPages'
        : assertion.kind === 'tableTotalItems'
          ? 'totalItems'
          : assertion.kind === 'tablePageSize'
            ? 'pageSize'
            : undefined;

  if (paginationKey) {
    const completeness = requireCompleteTableEvidence(assertion, tables);
    if ('pending' in completeness) {
      return completeness.pending;
    }
    tables = completeness.tables;
    const expected = Number.parseInt(assertion.expected, 10);
    const evidence = tables.length
      ? tables
          .map((table) => {
            const actual = table.pagination?.[paginationKey];
            return `${tableLabel(table)}：${actual === undefined ? '未观察到' : actual}`;
          })
          .join('；')
      : '未观察到表格';
    const passed = Number.isFinite(expected) && tables.some((table) => table.pagination?.[paginationKey] === expected);
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
        };
  }

  if (assertion.kind === 'tableFilter') {
    const filterName = assertion.filterName ?? '';
    const expectedValue = assertion.expected.replace(`${filterName} = `, '');
    const evidence = tables.length
      ? tables
          .map((table) =>
            `${tableLabel(table)}：${(table.filters ?? []).map((filter) => `${filter.label} = ${filter.value}`).join(' / ') || '未观察到筛选状态'}`,
          )
          .join('；')
      : '未观察到表格';
    const passed = tables.some((table) => (table.filters ?? []).some((filter) => filter.label === filterName && filter.value === expectedValue));
    return passed
      ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
      : {
          status: 'failed',
          summary: `${assertion.label}「${assertion.expected}」未通过。`,
          evidence,
          failureReason: `${assertion.label}不匹配「${assertion.expected}」。`,
        };
  }

  const aggregateName = assertion.aggregateName ?? '';
  const completeness = requireCompleteTableEvidence(assertion, tables);
  if ('pending' in completeness) {
    return completeness.pending;
  }
  tables = completeness.tables;
  const expectedValue = assertion.expected.replace(`${aggregateName} = `, '');
  const evidence = tables.length
    ? tables
        .map((table) =>
          `${tableLabel(table)}：${(table.aggregates ?? []).map((aggregate) => `${aggregate.label} = ${aggregate.value}`).join(' / ') || '未观察到聚合值'}`,
        )
        .join('；')
    : '未观察到表格';
  const passed = tables.some((table) =>
    (table.aggregates ?? []).some((aggregate) => aggregate.label === aggregateName && aggregate.value === expectedValue),
  );
  return passed
    ? { status: 'passed', summary: `${assertion.label}「${assertion.expected}」已通过。`, evidence }
    : {
        status: 'failed',
        summary: `${assertion.label}「${assertion.expected}」未通过。`,
        evidence,
        failureReason: `${assertion.label}不等于「${assertion.expected}」。`,
      };
};

const summarizeTables = (tables: NonNullable<AgentObservation['tables']>): string => {
  return tables
    .map((table) =>
      [
        table.caption,
        `${table.rowCount} 行`,
        `${table.columnCount} 列`,
        ...(table.filters ?? []).flatMap((filter) => [filter.label, filter.value]),
        ...(table.pagination ? Object.values(table.pagination).map(String) : []),
        ...(table.aggregates ?? []).flatMap((aggregate) => [aggregate.label, aggregate.value]),
        ...table.headers,
        ...table.sampleRows.flat(),
      ]
        .filter(Boolean)
        .join(' / '),
    )
    .join(' | ');
};

const selectAssertionTables = (
  tables: NonNullable<AgentObservation['tables']>,
  tableName: string | undefined,
): NonNullable<AgentObservation['tables']> => {
  if (!tableName) {
    return tables;
  }
  return tables.filter((table) => table.caption === tableName);
};

const selectAssertionCharts = (
  charts: NonNullable<AgentObservation['charts']>,
  chartName: string | undefined,
): NonNullable<AgentObservation['charts']> => {
  if (!chartName) {
    return charts;
  }
  return charts.filter((chart) => chart.title === chartName);
};

const summarizeCharts = (charts: NonNullable<AgentObservation['charts']>): string => {
  return charts
    .map((chart) =>
      [
        chart.title,
        chart.kind,
        chart.width && chart.height ? `${chart.width}x${chart.height}` : undefined,
        ...(chart.legends ?? []),
        chart.tooltip,
        ...(chart.dataPoints ?? []).flatMap((point) => [point.series, point.label, formatNumber(point.value)]),
        ...(chart.seriesTrends ?? []).flatMap((seriesTrend) => [seriesTrend.series, formatChartTrend(seriesTrend.trend)]),
        chart.trend ? formatChartTrend(chart.trend) : undefined,
      ]
        .filter(Boolean)
        .join(' / '),
    )
    .join(' | ');
};
