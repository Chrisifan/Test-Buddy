import { expect, test, vi } from 'vitest';

import { createBrowserSessionCoordinator } from './browser-session.js';

const idleSession = {
  id: 'browser-session-1',
  status: 'ready' as const,
  currentUrl: 'https://example.test/start',
  pageTitle: 'Start page',
  message: 'Ready',
  updatedAt: '2026-09-02T00:00:00.000Z',
};

test('prepares a planned navigation and retains structured browser observation', async () => {
  const navigate = vi.fn().mockResolvedValue({
    ...idleSession,
    currentUrl: 'https://example.test/orders',
    pageTitle: 'Orders',
  });
  const table = {
    index: 0,
    caption: 'Orders',
    rowCount: 1,
    columnCount: 1,
    headers: ['Number'],
    sampleRows: [['A-42']],
  };
  const chart = {
    index: 0,
    title: 'Orders by day',
    series: [],
  };
  const coordinator = createBrowserSessionCoordinator({
    browserObserver: {
      getState: () => idleSession,
      start: vi.fn(),
      navigate,
      click: vi.fn(),
      input: vi.fn(),
      capture: vi.fn().mockResolvedValue(idleSession),
      captureObservation: vi.fn().mockResolvedValue({ tables: [table], charts: [chart] }),
    },
  });

  await expect(coordinator.prepareForAgent({
    mode: 'ai',
    prompt: 'Open the orders page',
    runtimeProfile: { browser: 'chromium', baseUrl: '', viewport: 'desktop', locale: 'zh-CN', headless: true },
    targetEnvironment: 'Staging',
    browserSession: idleSession,
  } as never, {
    id: 'step-navigate',
    action: 'navigate',
    instruction: 'Open orders',
    title: 'Open orders',
    url: 'https://example.test/orders',
  } as never)).resolves.toMatchObject({
    navigatedUrl: 'https://example.test/orders',
    observation: { tables: [table], charts: [chart] },
    session: { currentUrl: 'https://example.test/orders' },
  });

  expect(navigate).toHaveBeenCalledWith({ url: 'https://example.test/orders' });
});
