import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';

describe('BrowserRuntime page access', () => {
  it('exposes no Playwright page before a real browser session starts', () => {
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));

    expect(runtime.getPage()).toBeNull();
    expect(runtime.hasRealPage()).toBe(false);
  });

  it('archives a Playwright trace only when a real browser context is available', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-browser-runtime-'));
    const tracing = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
    };
    const runtime = new BrowserRuntime(rootDir, new ArtifactManager(rootDir));
    (runtime as unknown as { context: { tracing: typeof tracing } }).context = { tracing };

    await expect(runtime.beginTrace('agent/run:1')).resolves.toBe(true);
    const trace = await runtime.finishTrace();

    expect(tracing.start).toHaveBeenCalledWith({ screenshots: true, snapshots: true, sources: true });
    expect(tracing.stop).toHaveBeenCalledWith({ path: trace?.path });
    expect(trace).toEqual(
      expect.objectContaining({
        type: 'trace',
        label: 'Playwright Trace',
        path: expect.stringMatching(/agent-run-1.+-trace\.zip$/),
      }),
    );
    expect(new ArtifactManager(rootDir).isManagedArtifactPath(trace?.path ?? '')).toBe(true);
  });

  it('does not fabricate a trace when no real browser context is available', async () => {
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));

    await expect(runtime.beginTrace('agent-run-stub')).resolves.toBe(false);
    await expect(runtime.finishTrace()).resolves.toBeUndefined();
  });

  it('captures structured table and chart evidence from the current page', async () => {
    document.body.innerHTML = `
      <main>
        <h1>成交统计</h1>
        <section data-table-container>
          <select data-filter="状态"><option>全部</option><option selected>成功</option></select>
          <table aria-label="订单列表" aria-rowcount="36" data-current-page="2" data-total-pages="4" data-page-size="10">
          <thead>
            <tr><th>交易对</th><th aria-sort="descending">成交量</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr><td>BTC/USDT</td><td>120</td><td>成功</td></tr>
            <tr><td>ETH/USDT</td><td>80</td><td>处理中</td></tr>
          </tbody>
          <tfoot><tr><td>合计</td><td data-aggregate="成交量" data-aggregate-value="200">200</td><td></td></tr></tfoot>
          </table>
          <nav data-pagination><button aria-current="page">2</button> / 4</nav>
        </section>
        <section aria-label="成交趋势" data-chart="trend">
          <h2>成交趋势</h2>
          <canvas width="640" height="240"></canvas>
          <span class="legend">买入</span>
          <span class="legend">卖出</span>
          <span data-point="一月" data-value="120"></span>
          <span data-point="二月" data-value="180"></span>
          <div role="tooltip" data-chart-for="trend">二月成交量：180</div>
        </section>
        <svg aria-label="资产分布" width="320" height="180"></svg>
      </main>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = {
      evaluate: async (script: () => unknown) => script(),
    };
    (runtime as unknown as { page: typeof page }).page = page;

    const observation = await runtime.captureObservation();

    expect(observation.tables).toEqual([
      {
        index: 1,
        evidenceCompleteness: 'partial',
        caption: '订单列表',
        rowCount: 2,
        columnCount: 3,
        headers: ['交易对', '成交量', '状态'],
        filters: [{ label: '状态', value: '成功' }],
        pagination: { currentPage: 2, totalPages: 4, totalItems: 36, pageSize: 10 },
        aggregates: [
          { label: '交易对', value: '合计' },
          { label: '成交量', value: '200' },
        ],
        sortStates: [{ column: '成交量', direction: 'descending' }],
        sampleRows: [
          ['BTC/USDT', '120', '成功'],
          ['ETH/USDT', '80', '处理中'],
        ],
      },
    ]);
    expect(observation.charts).toEqual([
      expect.objectContaining({
        index: 1,
        evidenceCompleteness: 'unknown',
        title: '成交趋势',
        kind: 'canvas',
        width: 640,
        height: 240,
        rendered: true,
        legends: ['买入', '卖出'],
        tooltip: '二月成交量：180',
        dataPoints: [
          { label: '一月', value: 120 },
          { label: '二月', value: 180 },
        ],
        trend: 'rising',
      }),
      expect.objectContaining({
        index: 2,
        evidenceCompleteness: 'unknown',
        title: '资产分布',
        kind: 'svg',
        width: 320,
        height: 180,
        rendered: true,
      }),
    ]);
    expect(observation.domSummary).toContain('1 个表格');
    expect(observation.domSummary).toContain('2 个图表');
  });

  it('captures named chart series and avoids inferring a cross-series trend', async () => {
    document.body.innerHTML = `
      <main>
        <section aria-label="成交趋势" data-chart="trend"><canvas width="640" height="240"></canvas>
          <span data-series="买入" data-point="一月" data-value="120"></span>
          <span data-series="卖出" data-point="一月" data-value="260"></span>
          <span data-series-name="买入" data-point="二月" data-value="180"></span>
          <span data-series-name="卖出" data-point="二月" data-value="140"></span>
          <span data-series="卖出" data-series-trend="flat"></span>
        </section>
        <section aria-label="明确趋势" data-chart="explicit-trend" data-trend="falling"><canvas width="320" height="180"></canvas>
          <span data-series="买入" data-point="一月" data-value="120"></span>
          <span data-series="卖出" data-point="一月" data-value="260"></span>
        </section>
      </main>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = { evaluate: async (script: () => unknown) => script() };
    (runtime as unknown as { page: typeof page }).page = page;

    const observation = await runtime.captureObservation();

    expect(observation.charts?.[0]).toMatchObject({
      title: '成交趋势',
      dataPoints: [
        { series: '买入', label: '一月', value: 120 },
        { series: '卖出', label: '一月', value: 260 },
        { series: '买入', label: '二月', value: 180 },
        { series: '卖出', label: '二月', value: 140 },
      ],
    });
    expect(observation.charts?.[0]?.trend).toBeUndefined();
    expect(observation.charts?.[0]?.seriesTrends).toEqual([
      { series: '买入', trend: 'rising' },
      { series: '卖出', trend: 'flat' },
    ]);
    expect(observation.charts?.[1]?.trend).toBe('falling');
  });

  it('inspects explicit DOM selectors without treating hidden elements as visible', async () => {
    document.body.innerHTML = `
      <main>
        <p id="summary" data-state="ready">登录成功</p>
        <button id="save" hidden>保存</button>
      </main>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = {
      evaluate: async <T>(
        script: (payload: { selector: string; attributeName?: string }) => T,
        payload: { selector: string; attributeName?: string },
      ) => script(payload),
    };
    (runtime as unknown as { page: typeof page }).page = page;

    await expect(runtime.inspectDom('#summary')).resolves.toEqual({
      selector: '#summary',
      found: true,
      visible: true,
      text: '登录成功',
    });
    await expect(runtime.inspectDom('#save')).resolves.toEqual({ selector: '#save', found: true, visible: false, text: '保存' });
    await expect(runtime.inspectDom('#summary', 'data-state')).resolves.toEqual({
      selector: '#summary',
      found: true,
      visible: true,
      text: '登录成功',
      attribute: { name: 'data-state', value: 'ready' },
    });
    await expect(runtime.inspectDom('#missing')).resolves.toEqual({ selector: '#missing', found: false, visible: false });
  });

  it('captures ARIA data grids through the same structured table contract', async () => {
    document.body.innerHTML = `
      <section data-table-container>
        <select data-filter="状态"><option>全部</option><option selected>活跃</option></select>
        <div role="grid" aria-label="会员列表" aria-rowcount="36" data-current-page="2" data-total-pages="4" data-page-size="10">
          <div role="row">
            <span role="columnheader">会员</span>
            <span role="columnheader" aria-sort="ascending">积分</span>
            <span role="columnheader">状态</span>
          </div>
          <div role="row">
            <span role="gridcell">Ada</span><span role="gridcell">120</span><span role="gridcell">活跃</span>
          </div>
          <div role="row">
            <span role="gridcell">Lin</span><span role="gridcell">80</span><span role="gridcell">活跃</span>
          </div>
        </div>
        <nav data-pagination><button aria-current="page">2</button> / 4</nav>
      </section>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = { evaluate: async (script: () => unknown) => script() };
    (runtime as unknown as { page: typeof page }).page = page;

    const observation = await runtime.captureObservation();

    expect(observation.tables).toEqual([
      {
        index: 1,
        evidenceCompleteness: 'partial',
        caption: '会员列表',
        rowCount: 2,
        columnCount: 3,
        headers: ['会员', '积分', '状态'],
        filters: [{ label: '状态', value: '活跃' }],
        pagination: { currentPage: 2, totalPages: 4, totalItems: 36, pageSize: 10 },
        sortStates: [{ column: '积分', direction: 'ascending' }],
        sampleRows: [
          ['Ada', '120', '活跃'],
          ['Lin', '80', '活跃'],
        ],
      },
    ]);
  });

  it('captures third-party grid pagination and a single chart library tooltip without custom data markers', async () => {
    document.body.innerHTML = `
      <main>
        <section>
          <div class="ag-root-wrapper">
            <div role="grid" aria-label="订单列表" aria-rowcount="36">
              <div role="row">
                <span role="columnheader">订单号</span>
                <span role="columnheader" aria-sort="descending">金额</span>
              </div>
              <div role="row"><span role="gridcell">ORD-001</span><span role="gridcell">120</span></div>
              <div role="row"><span role="gridcell">ORD-002</span><span role="gridcell">80</span></div>
            </div>
            <div class="ag-paging-panel"><span class="ag-paging-row-summary-panel">1 to 10 of 36</span></div>
          </div>
        </section>
        <section aria-label="销售趋势">
          <h2>销售趋势</h2>
          <div class="echarts-for-react" id="daily-sales">
            <canvas width="640" height="240"></canvas>
            <div class="echarts-legend">
              <span class="echarts-legend-item">成交额</span>
              <span class="echarts-legend-item">订单数</span>
            </div>
          </div>
        </section>
        <div class="echarts-tooltip"><div>二月</div><div>成交额：180</div></div>
        <svg id="decorative-icon" width="20" height="20"><path d="M0 0h20v20H0z" /></svg>
      </main>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = { evaluate: async (script: () => unknown) => script() };
    (runtime as unknown as { page: typeof page }).page = page;

    const observation = await runtime.captureObservation();

    expect(observation.tables).toEqual([
      {
        index: 1,
        evidenceCompleteness: 'partial',
        caption: '订单列表',
        rowCount: 2,
        columnCount: 2,
        headers: ['订单号', '金额'],
        pagination: { currentPage: 1, totalPages: 4, totalItems: 36, pageSize: 10 },
        sortStates: [{ column: '金额', direction: 'descending' }],
        sampleRows: [
          ['ORD-001', '120'],
          ['ORD-002', '80'],
        ],
      },
    ]);
    expect(observation.charts).toEqual([
      expect.objectContaining({
        index: 1,
        evidenceCompleteness: 'unknown',
        title: '销售趋势',
        kind: 'canvas',
        width: 640,
        height: 240,
        rendered: true,
        legends: ['成交额', '订单数'],
        tooltip: '二月成交额：180',
      }),
    ]);
    expect(observation.domSummary).toContain('1 个表格');
    expect(observation.domSummary).toContain('1 个图表');
  });

  it('does not infer a page size from a terminal third-party grid range', async () => {
    document.body.innerHTML = `
      <section>
        <div role="grid" aria-label="订单列表" aria-rowcount="36">
          <div role="row"><span role="columnheader">订单号</span></div>
          <div role="row"><span role="gridcell">ORD-031</span></div>
        </div>
        <div class="ag-paging-panel">31 to 36 of 36</div>
      </section>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = { evaluate: async (script: () => unknown) => script() };
    (runtime as unknown as { page: typeof page }).page = page;

    const observation = await runtime.captureObservation();

    expect(observation.tables?.[0]?.pagination).toEqual({ totalItems: 36 });
  });

  it('captures explicitly marked custom div data grids without relying on class names', async () => {
    document.body.innerHTML = `
      <section>
        <div
          data-grid
          data-label="结算列表"
          data-current-page="1"
          data-total-pages="3"
          data-total-items="24"
          data-page-size="8"
        >
          <div data-row><span data-column-header>客户</span><span data-column-header data-sort="descending">金额</span></div>
          <div data-row><span data-cell>Northwind</span><span data-cell>320</span></div>
          <div data-row><span data-cell>Contoso</span><span data-cell>180</span></div>
          <div data-aggregate="金额" data-aggregate-value="500">500</div>
        </div>
      </section>
    `;
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const page = { evaluate: async (script: () => unknown) => script() };
    (runtime as unknown as { page: typeof page }).page = page;

    const observation = await runtime.captureObservation();

    expect(observation.tables).toEqual([
      {
        index: 1,
        evidenceCompleteness: 'partial',
        caption: '结算列表',
        rowCount: 2,
        columnCount: 2,
        headers: ['客户', '金额'],
        pagination: { currentPage: 1, totalPages: 3, totalItems: 24, pageSize: 8 },
        aggregates: [{ label: '金额', value: '500' }],
        sortStates: [{ column: '金额', direction: 'descending' }],
        sampleRows: [
          ['Northwind', '320'],
          ['Contoso', '180'],
        ],
      },
    ]);
  });

  it('executes wait, waitForSelector, waitForNetworkIdle, waitForResponse, select, and scroll helpers against the current page', async () => {
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const calls: string[] = [];
    const page = {
      title: async () => 'Report',
      url: () => 'https://example.test/report',
      screenshot: async () => undefined,
      waitForTimeout: async (timeoutMs: number) => {
        calls.push(`wait:${timeoutMs}`);
      },
      waitForSelector: async (selector: string, options?: { timeout?: number; state?: string }) => {
        calls.push(`waitForSelector:${selector}:${options?.timeout}:${options?.state}`);
      },
      waitForLoadState: async (state: string, options?: { timeout?: number }) => {
        calls.push(`waitForLoadState:${state}:${options?.timeout}`);
      },
      waitForResponse: async (
        predicate: (response: { url: () => string; status: () => number }) => boolean,
        options?: { timeout?: number },
      ) => {
        calls.push(`waitForResponse:${options?.timeout}`);
        calls.push(`responseMatched:${predicate({ url: () => 'https://example.test/api/chart?range=30d', status: () => 200 })}`);
      },
      selectOption: async (selector: string, value: string) => {
        calls.push(`select:${selector}:${value}`);
      },
      evaluate: async (script: (payload: { selector?: string; x?: number; y?: number }) => unknown, payload: { selector?: string; x?: number; y?: number }) => {
        calls.push(`scroll:${payload.selector}:${payload.x}:${payload.y}`);
        return script(payload);
      },
    };
    (runtime as unknown as { page: typeof page; state: { id: string; status: string; currentUrl: string } }).page = page;
    (runtime as unknown as { state: { id: string; status: string; currentUrl: string } }).state = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/report',
    };
    const originalScrollBy = window.scrollBy;
    Object.defineProperty(window, 'scrollBy', { configurable: true, value: () => undefined });
    document.body.innerHTML = '<section id="chart"></section>';
    document.querySelector('#chart')!.scrollIntoView = () => calls.push('scrollIntoView:#chart');

    try {
      await runtime.wait({ timeoutMs: 1500 });
      await runtime.waitForSelector({ selector: '#export', timeoutMs: 1000 });
      await runtime.waitForNetworkIdle({ timeoutMs: 1500 });
      await runtime.waitForResponse({ urlPattern: '/api/chart', timeoutMs: 2500 });
      await runtime.select({ selector: '#status', value: 'success' });
      await runtime.scroll({ selector: '#chart', y: 320 });
    } finally {
      Object.defineProperty(window, 'scrollBy', { configurable: true, value: originalScrollBy });
    }

    expect(calls).toEqual([
      'wait:1500',
      'waitForSelector:#export:1000:visible',
      'waitForLoadState:networkidle:1500',
      'waitForResponse:2500',
      'responseMatched:true',
      'select:#status:success',
      'scroll:#chart:0:320',
      'scrollIntoView:#chart',
    ]);
  });

  it('waits until chart evidence remains stable on the current page', async () => {
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const calls: string[] = [];
    const drawImage = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage,
      getImageData: () => ({ data: new Uint8ClampedArray([10, 20, 30, 255]) }),
    } as unknown as CanvasRenderingContext2D);
    document.body.innerHTML = `
      <section id="sales-chart" aria-label="销售趋势">
        <canvas width="640" height="240"></canvas>
        <span>买入</span>
        <span>卖出</span>
      </section>
    `;
    const page = {
      title: async () => 'Dashboard',
      url: () => 'https://example.test/dashboard',
      screenshot: async () => undefined,
      waitForTimeout: async (timeoutMs: number) => {
        calls.push(`wait:${timeoutMs}`);
      },
      evaluate: async (script: (payload: { selector?: string }) => unknown, payload: { selector?: string }) => {
        calls.push(`evaluate:${payload.selector}`);
        return script(payload);
      },
    };
    (runtime as unknown as { page: typeof page; state: { id: string; status: string; currentUrl: string } }).page = page;
    (runtime as unknown as { state: { id: string; status: string; currentUrl: string } }).state = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/dashboard',
    };

    try {
      await runtime.waitForChartStable({ selector: '#sales-chart', timeoutMs: 500, stableMs: 0 });
    } finally {
      getContext.mockRestore();
    }

    expect(calls).toEqual(['evaluate:#sales-chart', 'evaluate:#sales-chart', 'evaluate:#sales-chart']);
    expect(drawImage).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#sales-chart')?.hasAttribute('data-testbuddy-chart-stability-lock')).toBe(false);
    expect(document.querySelector('[id^="testbuddy-chart-stability-"]')).toBeNull();
  });

  it('waits until table data is ready on the current page', async () => {
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));
    const calls: string[] = [];
    document.body.innerHTML = `
      <table id="orders-table" aria-label="订单列表">
        <thead><tr><th>订单号</th><th>状态</th></tr></thead>
        <tbody><tr><td>ORD-001</td><td>成功</td></tr></tbody>
      </table>
    `;
    const page = {
      title: async () => 'Orders',
      url: () => 'https://example.test/orders',
      screenshot: async () => undefined,
      waitForTimeout: async (timeoutMs: number) => {
        calls.push(`wait:${timeoutMs}`);
      },
      evaluate: async (script: (payload: { selector?: string }) => unknown, payload: { selector?: string }) => {
        calls.push(`evaluate:${payload.selector}`);
        return script(payload);
      },
    };
    (runtime as unknown as { page: typeof page; state: { id: string; status: string; currentUrl: string } }).page = page;
    (runtime as unknown as { state: { id: string; status: string; currentUrl: string } }).state = {
      id: 'session-ready',
      status: 'ready',
      currentUrl: 'https://example.test/orders',
    };

    await runtime.waitForDataReady({ selector: '#orders-table', timeoutMs: 500, stableMs: 0 });

    expect(calls).toEqual(['evaluate:#orders-table']);
  });
});
