import { describe, expect, it } from 'vitest';

import { ArtifactManager } from './artifact-manager.js';
import { BrowserRuntime } from './browser-runtime.js';

describe('BrowserRuntime page access', () => {
  it('exposes no Playwright page before a real browser session starts', () => {
    const runtime = new BrowserRuntime('/tmp/playtest-browser-runtime-test', new ArtifactManager('/tmp'));

    expect(runtime.getPage()).toBeNull();
  });

  it('captures structured table and chart evidence from the current page', async () => {
    document.body.innerHTML = `
      <main>
        <h1>成交统计</h1>
        <table aria-label="订单列表">
          <thead>
            <tr><th>交易对</th><th aria-sort="descending">成交量</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr><td>BTC/USDT</td><td>120</td><td>成功</td></tr>
            <tr><td>ETH/USDT</td><td>80</td><td>处理中</td></tr>
          </tbody>
        </table>
        <section aria-label="成交趋势" data-chart="trend">
          <h2>成交趋势</h2>
          <canvas width="640" height="240"></canvas>
          <span class="legend">买入</span>
          <span class="legend">卖出</span>
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
        caption: '订单列表',
        rowCount: 2,
        columnCount: 3,
        headers: ['交易对', '成交量', '状态'],
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
        title: '成交趋势',
        kind: 'canvas',
        width: 640,
        height: 240,
        rendered: true,
        legends: ['买入', '卖出'],
      }),
      expect.objectContaining({
        index: 2,
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

    await runtime.waitForChartStable({ selector: '#sales-chart', timeoutMs: 500, stableMs: 0 });

    expect(calls).toEqual(['evaluate:#sales-chart']);
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
