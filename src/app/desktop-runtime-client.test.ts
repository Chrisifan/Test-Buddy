import { afterEach, expect, test, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../lib/runtime.js');
  vi.resetModules();
});

test('defers loading the desktop runtime until a facade operation is called', async () => {
  const session = { id: 'session-1', status: 'ready' };
  const captureBrowserSnapshot = vi.fn().mockResolvedValue(session);
  const loadRuntime = vi.fn(async () => ({ captureBrowserSnapshot }));
  vi.doMock('../lib/runtime.js', () => loadRuntime());

  const { captureBrowserSnapshot: capture } = await import('./desktop-runtime-client.js');

  expect(loadRuntime).not.toHaveBeenCalled();
  await expect(capture()).resolves.toEqual(session);
  await expect(capture()).resolves.toEqual(session);
  expect(loadRuntime).toHaveBeenCalledTimes(1);
  expect(captureBrowserSnapshot).toHaveBeenCalledTimes(2);
});
