import type { AgentPlanStepDraft } from '../../shared/agent.js';
import type { ChatCommandRequest } from '../../shared/studio.js';

type ExplicitAssertionKind =
  | 'urlContains'
  | 'titleContains'
  | 'pageContains'
  | 'tableContains'
  | 'tableRowCount'
  | 'tableColumnCount'
  | 'tableCellEquals'
  | 'tableColumnContains'
  | 'tableColumnSum'
  | 'tableSort'
  | 'tableFilter'
  | 'tableCurrentPage'
  | 'tableTotalPages'
  | 'tableTotalItems'
  | 'tablePageSize'
  | 'tableAggregateEquals'
  | 'domSelectorExists'
  | 'domSelectorVisible'
  | 'domSelectorTextContains'
  | 'domSelectorAttributeEquals'
  | 'chartContains'
  | 'chartCount'
  | 'chartRendered'
  | 'chartTitleEquals'
  | 'chartLegendContains'
  | 'chartTooltipContains'
  | 'chartDataContains'
  | 'chartSeriesContains'
  | 'chartDataPointEquals'
  | 'chartSeriesDataPointEquals'
  | 'chartSeriesTrend'
  | 'chartTrend';

export interface ExplicitAssertionIntent {
  kind: ExplicitAssertionKind;
  expected: string;
  label: string;
  rowIndex?: number;
  columnIndex?: number;
  columnName?: string;
  sortColumn?: string;
  sortDirection?: 'ascending' | 'descending';
  filterName?: string;
  aggregateName?: string;
  tableName?: string;
  chartName?: string;
  domSelector?: string;
  domAttributeName?: string;
  chartDataPointLabel?: string;
  chartSeriesName?: string;
  chartTrend?: 'rising' | 'falling' | 'flat' | 'mixed';
}

interface ExecutionIntent {
  explicitUrl?: string;
  clickIntent?: { selector?: string; target?: string };
  inputIntent?: { selector?: string; target?: string; value: string };
  waitIntent?: {
    timeoutMs: number;
    selector?: string;
    urlPattern?: string;
    strategy?: 'selector' | 'chartStable' | 'dataReady' | 'response' | 'networkIdle' | 'timeout';
  };
  scrollIntent?: { selector?: string; x?: number; y?: number };
  selectIntent?: { selector?: string; target?: string; value: string };
  extractIntent?: { target?: string };
  assertionIntent?: ExplicitAssertionIntent;
  semanticAssertion?: string;
}

const extractExplicitUrl = (text: string): string | undefined => {
  const match = text.match(/https?:\/\/[^\s"'<>，。；、)）\]]+/i);
  return match?.[0];
};

const extractClickIntent = (text: string): { selector?: string; target?: string } | undefined => {
  const selectorMatch = text.match(/(?:点击|click)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  if (selectorMatch?.[1]) {
    return { selector: selectorMatch[1].replace(/^`|`$/g, '') };
  }

  const targetMatch = text.match(/(?:点击|click)\s*([^，。；,.、\n]+)/i);
  const target = targetMatch?.[1]?.trim();
  return target ? { target } : undefined;
};

const extractInputIntent = (text: string): { selector?: string; target?: string; value: string } | undefined => {
  const selectorInput = text.match(
    /(?:在|向|给|输入到|填入)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:中|里)?\s*(?:输入|填入|填写)\s*([^，。；,\n]+)/i,
  );
  if (selectorInput?.[1] && selectorInput[2]) {
    return {
      selector: selectorInput[1].replace(/^`|`$/g, ''),
      value: selectorInput[2].trim(),
    };
  }

  const fillSelector = text.match(/(?:fill|type)\s+(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s+(?:with\s+)?([^，。；,\n]+)/i);
  if (fillSelector?.[1] && fillSelector[2]) {
    return {
      selector: fillSelector[1].replace(/^`|`$/g, ''),
      value: fillSelector[2].trim(),
    };
  }

  const semanticInput = text.match(/(?:在|向|给)\s*([^，。；,\n]+?)\s*(?:中|里)?\s*(?:输入|填入|填写)\s*([^，。；,\n]+)/i);
  if (semanticInput?.[1] && semanticInput[2]) {
    return {
      target: semanticInput[1].trim(),
      value: semanticInput[2].trim(),
    };
  }

  return undefined;
};

const extractSelectIntent = (text: string): { selector?: string; target?: string; value: string } | undefined => {
  const selectorSelect = text.match(
    /(?:在|向|给)?\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:中|里)?\s*(?:选择|选中|select)\s*([^，。；,\n]+)/i,
  );
  if (selectorSelect?.[1] && selectorSelect[2]) {
    return { selector: selectorSelect[1].replace(/^`|`$/g, ''), value: selectorSelect[2].trim() };
  }

  const semanticSelect = text.match(/(?:在|向|给)?\s*([^，。；,\n]+?)\s*(?:中|里)?\s*(?:选择|选中|select)\s*([^，。；,\n]+)/i);
  if (semanticSelect?.[1] && semanticSelect[2]) {
    return { target: semanticSelect[1].trim(), value: semanticSelect[2].trim() };
  }

  return undefined;
};

const extractQueryIntent = (text: string): { target?: string } => {
  const match = text.match(
    /(?:提取|读取|查询|获取|extract|query)\s*(?:(?:当前)?页面(?:中|里|的)?\s*)?(.+?)(?:[。；，,\n]|$)/i,
  );
  const target = normalizeCapturedValue(match?.[1] ?? '');
  return target ? { target } : {};
};

const extractWaitMs = (text: string): number | undefined => {
  const milliseconds = text.match(/(?:等待|wait)[\s\S]{0,100}?(\d+)\s*(?:毫秒|ms)/i);
  if (milliseconds?.[1]) {
    return Math.min(Math.max(Number.parseInt(milliseconds[1], 10), 0), 30_000);
  }

  const seconds = text.match(/(?:等待|wait)[\s\S]{0,100}?(\d+(?:\.\d+)?)\s*(?:秒|s|sec|second|seconds)/i);
  if (seconds?.[1]) {
    return Math.min(Math.max(Math.round(Number.parseFloat(seconds[1]) * 1_000), 0), 30_000);
  }

  const bareSeconds = text.match(/(?:等待|wait)\s*(\d+(?:\.\d+)?)/i);
  if (bareSeconds?.[1]) {
    return Math.min(Math.max(Math.round(Number.parseFloat(bareSeconds[1]) * 1_000), 0), 30_000);
  }

  return undefined;
};

const extractDirectWaitIntent = (text: string): ExecutionIntent['waitIntent'] | undefined => {
  if (!/(?:等待|wait)/i.test(text)) {
    return undefined;
  }
  const selectorMatch = text.match(/(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  const selector = selectorMatch?.[1]?.replace(/^`|`$/g, '');
  const timeoutMs = extractWaitMs(text) ?? 1_000;
  const responseUrlPattern = selector ? undefined : extractApiPath(text);
  const strategy = isChartStableWaitInstruction(text)
    ? 'chartStable' as const
    : responseUrlPattern
      ? 'response' as const
      : isDataReadyWaitInstruction(text)
        ? 'dataReady' as const
        : selector
          ? 'selector' as const
          : isNetworkIdleWaitInstruction(text)
            ? 'networkIdle' as const
            : 'timeout' as const;
  return {
    timeoutMs,
    ...(selector ? { selector } : {}),
    ...(responseUrlPattern ? { urlPattern: responseUrlPattern } : {}),
    strategy,
  };
};

const extractScrollIntent = (text: string): { selector?: string; x?: number; y?: number } | undefined => {
  if (!/(?:滚动|scroll)/i.test(text)) {
    return undefined;
  }
  const selectorMatch = text.match(/(?:滚动到|scroll\s+to)\s*(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])/i);
  if (selectorMatch?.[1]) {
    return { selector: selectorMatch[1].replace(/^`|`$/g, '') };
  }
  return { y: /(?:向上|上滚|scroll\s+up)/i.test(text) ? -800 : 800 };
};

const isNetworkIdleWaitInstruction = (text: string): boolean => {
  return /(?:network\s*idle|networkidle|网络空闲|接口稳定|请求稳定|数据稳定|等待接口|等待请求)/i.test(text);
};

const isChartStableWaitInstruction = (text: string): boolean => {
  return /(?:(?:图表|趋势图|折线图|柱状图|饼图|chart|graph).*(?:稳定|渲染完成|加载完成|绘制完成|stable|rendered|loaded)|(?:稳定|渲染完成|加载完成|绘制完成|stable|rendered|loaded).*(?:图表|趋势图|折线图|柱状图|饼图|chart|graph))/i.test(
    text,
  );
};

const isDataReadyWaitInstruction = (text: string): boolean => {
  return /(?:(?:数据|表格|列表|结果|订单|记录|table|grid|list|rows?).*(?:就绪|加载完成|加载完毕|返回完成|渲染完成|ready|loaded|available)|(?:等待|wait).*(?:数据|表格|列表|结果|table|grid|list|rows?).*(?:完成|就绪|ready|loaded))/i.test(
    text,
  );
};

const extractApiPath = (text: string): string | undefined => {
  const match = text.match(/\/api\/[^\s"'<>，。；、)）\]]+/i);
  return match?.[0];
};

export const extractResponseUrlPattern = (step: AgentPlanStepDraft): string | undefined => {
  const candidates = [step.target, step.url, step.instruction].filter((value): value is string => Boolean(value?.trim()));
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const explicitUrl = extractExplicitUrl(trimmed);
    if (explicitUrl) {
      return explicitUrl;
    }
    const apiPath = extractApiPath(trimmed);
    if (apiPath) {
      return apiPath;
    }
  }
  return undefined;
};

const resolveScrollIntent = (step: AgentPlanStepDraft): { selector?: string; x?: number; y?: number } => {
  const value = `${step.value ?? ''} ${step.instruction}`;
  const y = /(?:up|向上|上滚)/i.test(value) ? -800 : /(?:down|向下|下滚|scroll|滚动)/i.test(value) ? 800 : undefined;
  return {
    ...(step.selector ? { selector: step.selector } : {}),
    ...(y !== undefined ? { y } : {}),
  };
};

const normalizeCapturedValue = (value: string): string => {
  return value
    .trim()
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .trim();
};

const normalizeSortDirection = (value: string): 'ascending' | 'descending' | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === '升序' || normalized === 'ascending' || normalized === 'asc') {
    return 'ascending';
  }
  if (normalized === '降序' || normalized === 'descending' || normalized === 'desc') {
    return 'descending';
  }
  return undefined;
};

const normalizeChartTrend = (value: string): ExplicitAssertionIntent['chartTrend'] | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === '上升' || normalized === 'rising') return 'rising';
  if (normalized === '下降' || normalized === 'falling') return 'falling';
  if (normalized === '平稳' || normalized === 'flat') return 'flat';
  if (normalized === 'mixed') return 'mixed';
  return undefined;
};

export const formatChartTrend = (trend: NonNullable<ExplicitAssertionIntent['chartTrend']>): string => {
  return trend === 'rising' ? '上升' : trend === 'falling' ? '下降' : trend === 'flat' ? '平稳' : 'mixed';
};

const extractAssertionIntent = (text: string): ExplicitAssertionIntent | undefined => {
  const tableTargetMatch = text.match(/(?:表格|table)\s*(?:「([^」]+)」|“([^”]+)”|["'`]([^"'`]+)["'`])/i);
  const tableName = normalizeCapturedValue(tableTargetMatch?.[1] ?? tableTargetMatch?.[2] ?? tableTargetMatch?.[3] ?? '');
  if (tableTargetMatch && tableName) {
    const normalizedText = text.replace(tableTargetMatch[0], /table/i.test(tableTargetMatch[0]) ? 'table ' : '表格 ');
    const parsed = extractAssertionIntent(normalizedText);
    return parsed?.kind.startsWith('table') ? { ...parsed, tableName } : parsed;
  }
  const chartTargetMatch = text.match(/(?:图表|chart)\s*(?:「([^」]+)」|“([^”]+)”|["'`]([^"'`]+)["'`])/i);
  const chartName = normalizeCapturedValue(chartTargetMatch?.[1] ?? chartTargetMatch?.[2] ?? chartTargetMatch?.[3] ?? '');
  if (chartTargetMatch && chartName) {
    const normalizedText = text.replace(chartTargetMatch[0], /chart/i.test(chartTargetMatch[0]) ? 'chart ' : '图表 ');
    const parsed = extractAssertionIntent(normalizedText);
    return parsed?.kind.startsWith('chart') ? { ...parsed, chartName } : parsed;
  }
  const patterns: Array<[ExplicitAssertionKind, string, RegExp]> = [
    ['urlContains', 'URL 包含', /(?:断言|验证|检查|assert)\s*(?:url|URL|地址|链接)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['titleContains', '标题包含', /(?:断言|验证|检查|assert)\s*(?:标题|title)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['pageContains', '页面包含', /(?:断言|验证|检查|assert)\s*(?:页面|文本|正文|内容|page|text)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['tableContains', '表格包含', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['tableRowCount', '表格行数', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:行数|rows?)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i],
    ['tableColumnCount', '表格列数', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:列数|columns?|cols?)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i],
    ['tableCellEquals', '表格单元格', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:第\s*)?(\d+)\s*(?:行|row)\s*(?:第\s*)?(\d+)\s*(?:列|column|col)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i],
    ['tableColumnContains', '表格列包含', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:列|column|col)\s*([^，。；,\n]+?)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['tableColumnSum', '表格列合计', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:列|column|col)\s*([^，。；,\n]+?)\s*(?:合计|总和|sum|total)\s*(?:为|等于|是|=|equals?)\s*(-?\d+(?:\.\d+)?)/i],
    ['tableSort', '表格排序', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:按|by)\s*([^，。；,\n]+?)\s*(升序|降序|ascending|descending|asc|desc)/i],
    ['tableFilter', '表格筛选', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:筛选|filter)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i],
    ['tableCurrentPage', '表格当前页', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:当前页|current\s*page)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i],
    ['tableTotalPages', '表格总页数', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:总页数|total\s*pages?)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i],
    ['tableTotalItems', '表格总条数', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:总条数|总记录数|总数|total\s*(?:items?|records?))\s*(?:为|等于|是|=|equals?)\s*(\d+)/i],
    ['tablePageSize', '表格每页条数', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:每页|page\s*size)\s*(?:为|等于|是|=|equals?)?\s*(\d+)\s*(?:条|rows?|items?)?/i],
    ['tableAggregateEquals', '表格聚合值', /(?:断言|验证|检查|assert)\s*(?:表格|table)\s*(?:聚合|汇总|aggregate)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i],
    ['domSelectorTextContains', 'DOM 文本', /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:文本|text)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['domSelectorAttributeEquals', 'DOM 属性', /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:属性|attribute)\s*([\w-]+)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i],
    ['domSelectorVisible', 'DOM 可见', /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:可见|visible)/i],
    ['domSelectorExists', 'DOM 存在', /(?:断言|验证|检查|assert)\s*(?:dom\s*)?(`[^`]+`|#[\w-]+|\.[\w-]+|\[[^\]]+\])\s*(?:存在|exists?|present)/i],
    ['chartContains', '图表包含', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['chartCount', '图表数量', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数量|个数|count)\s*(?:为|等于|是|=|equals?)\s*(\d+)/i],
    ['chartRendered', '图表渲染', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:已渲染|渲染正常|rendered)/i],
    ['chartTitleEquals', '图表标题', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:标题|title)\s*(?:为|等于|是|=|equals?)\s*([^，。；,\n]+)/i],
    ['chartLegendContains', '图表图例', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:图例|legend)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['chartTooltipContains', '图表提示', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:tooltip|提示)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['chartDataContains', '图表数据区域', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据区域|数据|data(?:\s*region)?)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['chartSeriesContains', '图表系列', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据系列|系列|series)\s*(?:包含|含有|contains)\s*([^，。；,\n]+)/i],
    ['chartSeriesTrend', '图表系列趋势', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据系列|系列|series)\s*([^，。；,\n]+?)\s*(?:趋势|trend)\s*(上升|下降|平稳|rising|falling|flat|mixed)/i],
    ['chartSeriesDataPointEquals', '图表系列数据点', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据系列|系列|series)\s*([^，。；,\n]+?)\s*(?:数据点|data\s*point)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*(-?\d+(?:\.\d+)?)/i],
    ['chartDataPointEquals', '图表数据点', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:数据点|data\s*point)\s*([^，。；,\n]+?)\s*(?:为|等于|是|=|equals?)\s*(-?\d+(?:\.\d+)?)/i],
    ['chartTrend', '图表趋势', /(?:断言|验证|检查|assert)\s*(?:图表|图|chart)\s*(?:趋势|trend)\s*(上升|下降|平稳|rising|falling|flat|mixed)/i],
  ];

  for (const [kind, label, pattern] of patterns) {
    const match = text.match(pattern);
    if (kind === 'tableCellEquals') {
      const rowIndex = match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
      const columnIndex = match?.[2] ? Number.parseInt(match[2], 10) : Number.NaN;
      const expected = match?.[3] ? normalizeCapturedValue(match[3]) : '';
      if (Number.isFinite(rowIndex) && Number.isFinite(columnIndex) && expected) {
        return { kind, expected, label, rowIndex, columnIndex };
      }
      continue;
    }
    if (kind === 'tableColumnContains') {
      const columnName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (columnName && expected) {
        return { kind, expected: `${columnName} 包含 ${expected}`, label, columnName };
      }
      continue;
    }
    if (kind === 'tableColumnSum') {
      const columnName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (columnName && expected) {
        return { kind, expected: `${columnName} 合计 ${expected}`, label, columnName };
      }
      continue;
    }
    if (kind === 'tableSort') {
      const sortColumn = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const sortDirection = normalizeSortDirection(match?.[2] ?? '');
      if (sortColumn && sortDirection) {
        return {
          kind,
          expected: `${sortColumn} ${sortDirection === 'ascending' ? '升序' : '降序'}`,
          label,
          sortColumn,
          sortDirection,
        };
      }
      continue;
    }
    if (kind === 'tableFilter') {
      const filterName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (filterName && expected) {
        return { kind, expected: `${filterName} = ${expected}`, label, filterName };
      }
      continue;
    }
    if (kind === 'tableAggregateEquals') {
      const aggregateName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (aggregateName && expected) {
        return { kind, expected: `${aggregateName} = ${expected}`, label, aggregateName };
      }
      continue;
    }
    if (kind === 'domSelectorTextContains') {
      const domSelector = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const expected = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (domSelector && expected) {
        return { kind, expected, label, domSelector };
      }
      continue;
    }
    if (kind === 'domSelectorAttributeEquals') {
      const domSelector = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const domAttributeName = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      const expected = match?.[3] ? normalizeCapturedValue(match[3]) : '';
      if (domSelector && domAttributeName && expected) {
        return { kind, expected, label, domSelector, domAttributeName };
      }
      continue;
    }
    if (kind === 'domSelectorExists' || kind === 'domSelectorVisible') {
      const domSelector = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      if (domSelector) {
        return { kind, expected: domSelector, label, domSelector };
      }
      continue;
    }
    if (kind === 'chartRendered') {
      if (match) {
        return { kind, expected: '已渲染', label };
      }
      continue;
    }
    if (kind === 'chartTrend') {
      const chartTrend = normalizeChartTrend(match?.[1] ?? '');
      if (chartTrend) {
        return { kind, expected: formatChartTrend(chartTrend), label, chartTrend };
      }
      continue;
    }
    if (kind === 'chartSeriesTrend') {
      const chartSeriesName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const chartTrend = normalizeChartTrend(match?.[2] ?? '');
      if (chartSeriesName && chartTrend) {
        return { kind, expected: `${chartSeriesName} ${formatChartTrend(chartTrend)}`, label, chartSeriesName, chartTrend };
      }
      continue;
    }
    if (kind === 'chartDataPointEquals') {
      const chartDataPointLabel = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const pointValue = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      if (chartDataPointLabel && pointValue) {
        return { kind, expected: `${chartDataPointLabel} = ${pointValue}`, label, chartDataPointLabel };
      }
      continue;
    }
    if (kind === 'chartSeriesDataPointEquals') {
      const chartSeriesName = match?.[1] ? normalizeCapturedValue(match[1]) : '';
      const chartDataPointLabel = match?.[2] ? normalizeCapturedValue(match[2]) : '';
      const pointValue = match?.[3] ? normalizeCapturedValue(match[3]) : '';
      if (chartSeriesName && chartDataPointLabel && pointValue) {
        return {
          kind,
          expected: `${chartSeriesName} / ${chartDataPointLabel} = ${pointValue}`,
          label,
          chartSeriesName,
          chartDataPointLabel,
        };
      }
      continue;
    }

    const expected = match?.[1] ? normalizeCapturedValue(match[1]) : '';
    if (expected) {
      return { kind, expected, label };
    }
  }

  return undefined;
};

export const resolveExecutionIntent = (request: ChatCommandRequest, plannedStep?: AgentPlanStepDraft): ExecutionIntent => {
  if (!plannedStep) {
    const assertionIntent = extractAssertionIntent(request.prompt);
    const explicitUrl = extractExplicitUrl(request.prompt);
    const clickIntent = extractClickIntent(request.prompt);
    const inputIntent = extractInputIntent(request.prompt);
    const selectIntent = extractSelectIntent(request.prompt);
    const extractIntent = request.mode === 'aiQuery' ? extractQueryIntent(request.prompt) : undefined;
    const waitIntent = extractDirectWaitIntent(request.prompt);
    const scrollIntent = extractScrollIntent(request.prompt);
    return {
      ...(explicitUrl ? { explicitUrl } : {}),
      ...(clickIntent ? { clickIntent } : {}),
      ...(inputIntent ? { inputIntent } : {}),
      ...(selectIntent ? { selectIntent } : {}),
      ...(extractIntent ? { extractIntent } : {}),
      ...(waitIntent ? { waitIntent } : {}),
      ...(scrollIntent ? { scrollIntent } : {}),
      ...(assertionIntent ? { assertionIntent } : {}),
      ...(request.mode === 'aiAssert' && !assertionIntent ? { semanticAssertion: request.prompt.trim() } : {}),
    };
  }

  const instruction = plannedStep.instruction;
  if (plannedStep.action === 'navigate') {
    const explicitUrl = plannedStep.url ?? extractExplicitUrl(instruction);
    return explicitUrl ? { explicitUrl } : {};
  }
  if (plannedStep.action === 'click') {
    const parsed = extractClickIntent(instruction);
    const clickIntent = plannedStep.selector
      ? { selector: plannedStep.selector }
      : plannedStep.target
        ? { target: plannedStep.target }
        : parsed;
    return clickIntent ? { clickIntent } : {};
  }
  if (plannedStep.action === 'input') {
    const parsed = extractInputIntent(instruction);
    const value = plannedStep.value ?? parsed?.value;
    if (value === undefined) {
      return {};
    }
    const inputIntent = plannedStep.selector
      ? { selector: plannedStep.selector, value }
      : plannedStep.target
        ? { target: plannedStep.target, value }
        : parsed;
    return inputIntent ? { inputIntent } : {};
  }
  if (plannedStep.action === 'wait') {
    const timeoutMs = plannedStep.timeoutMs ?? extractWaitMs(instruction) ?? 1_000;
    const waitsForChartStability = isChartStableWaitInstruction(instruction);
    const waitsForDataReadiness = isDataReadyWaitInstruction(instruction);
    const responseUrlPattern = plannedStep.selector ? undefined : extractResponseUrlPattern(plannedStep);
    return {
      waitIntent: {
        timeoutMs,
        ...(plannedStep.selector ? { selector: plannedStep.selector } : {}),
        ...(waitsForChartStability
          ? { strategy: 'chartStable' as const }
          : responseUrlPattern
            ? { urlPattern: responseUrlPattern, strategy: 'response' as const }
            : waitsForDataReadiness
              ? { strategy: 'dataReady' as const }
              : plannedStep.selector
                ? { strategy: 'selector' as const }
                : {}),
        ...(!plannedStep.selector &&
        !responseUrlPattern &&
        !waitsForChartStability &&
        !waitsForDataReadiness &&
        isNetworkIdleWaitInstruction(instruction)
          ? { strategy: 'networkIdle' as const }
          : {}),
      },
    };
  }
  if (plannedStep.action === 'scroll') {
    return { scrollIntent: resolveScrollIntent(plannedStep) };
  }
  if (plannedStep.action === 'select') {
    const parsed = extractSelectIntent(instruction);
    const value = plannedStep.value ?? parsed?.value;
    if (value === undefined) {
      return {};
    }
    const selectIntent = plannedStep.selector
      ? { selector: plannedStep.selector, value }
      : plannedStep.target
        ? { target: plannedStep.target, value }
        : parsed;
    return selectIntent ? { selectIntent } : {};
  }
  if (plannedStep.action === 'assert') {
    const assertionIntent = extractAssertionIntent(instruction);
    return assertionIntent ? { assertionIntent } : { semanticAssertion: instruction };
  }
  if (plannedStep.action === 'extract') {
    return { extractIntent: { ...(plannedStep.target ? { target: plannedStep.target } : {}) } };
  }
  return {};
};

export const isObservationIntent = (text: string): boolean => {
  return /(?:观察|查看|读取|检查|分析)(?:一下)?(?:当前)?页面|(?:observe|inspect)\s+(?:the\s+)?(?:current\s+)?page/i.test(text);
};
