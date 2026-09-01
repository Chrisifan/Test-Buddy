import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { createEmptyProject, createEmptySuiteAsset, createEmptyTestCase } from '../../shared/studio.js';
import { createRuntimeBundle } from './runtime-bundle.js';

describe('local browser runtime smoke', () => {
  it('runs confirmed deterministic Case steps and stores a real page PNG', async () => {
    const fixture = await startFixture();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-browser-smoke-'));
    const bundle = createRuntimeBundle({
      rootDir,
      visualDiffImageAdapter: { read: async () => Buffer.alloc(0), write: async () => undefined },
    });
    const project = createEmptyProject(1);
    const environment = {
      ...project.environments[0]!,
      url: fixture.url,
      entryPath: '/',
      browser: 'chromium' as const,
      headless: true,
    };
    const testCase = {
      ...createEmptyTestCase(1, project.groups[0]!.id, environment.id),
      id: 'case-browser-smoke',
      version: 1,
      name: 'Browser smoke',
      url: fixture.url,
      steps: [
        {
          id: 'step-navigate',
          type: 'ai' as const,
          title: 'Open fixture',
          body: 'Open the local fixture.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Open the local fixture.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: { kind: 'navigate' as const, url: fixture.url },
          },
        },
        {
          id: 'step-click',
          type: 'ai' as const,
          title: 'Continue',
          body: 'Click the continue button.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Click the continue button.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            action: { kind: 'click' as const, locator: { selector: '#continue', quality: 'acceptable' as const } },
          },
        },
        {
          id: 'step-assert',
          type: 'aiAssert' as const,
          title: 'Fixture is ready',
          body: 'Assert that the fixture says ready.',
          execution: {
            schemaVersion: 2 as const,
            intent: 'Assert that the fixture says ready.',
            reviewStatus: 'confirmed' as const,
            actionRisk: 'low' as const,
            assertion: { id: 'assert-ready', version: 1 as const, kind: 'pageContains' as const, expected: 'ready' },
          },
        },
      ],
    };
    const runtimeProject = { ...project, environments: [environment], testCases: [testCase] };

    try {
      const response = await bundle.runTestCase({
        runId: 'browser-smoke-run',
        projectSnapshot: {
          project: runtimeProject,
          revision: 'a'.repeat(64),
          source: 'legacyStudioStore',
          reproducibility: 'legacy',
        },
        environment,
        testCase,
      });

      expect(response.detail.status, JSON.stringify({
        summary: response.detail.summary,
        steps: response.detail.steps,
        browser: bundle.browserRuntime.getState(),
      })).toBe('passed');
      expect(response.detail.steps.map((step) => step.status)).toEqual(['passed', 'passed', 'passed']);
      await expect(bundle.browserRuntime.getPage()?.evaluate(() => document.body.dataset.continued)).resolves.toBe('yes');

      const screenshot = response.detail.artifacts.find((artifact) => artifact.type === 'screenshot');
      expect(screenshot).toBeDefined();
      const png = await fs.readFile(screenshot!.path);
      expect(png.byteLength).toBeGreaterThan(0);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    } finally {
      await bundle.close();
      await fixture.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('executes approved structured interactions against the local fixture with managed evidence', async () => {
    const fixture = await startFixture();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-browser-controlled-smoke-'));
    const bundle = createRuntimeBundle({
      rootDir,
      visualDiffImageAdapter: { read: async () => Buffer.alloc(0), write: async () => undefined },
    });
    const project = createEmptyProject(1);
    const environment = {
      ...project.environments[0]!,
      url: fixture.url,
      entryPath: '/',
      browser: 'chromium' as const,
      headless: true,
    };
    const uploadPath = path.join(rootDir, 'approved-upload.txt');
    await fs.writeFile(uploadPath, 'approved upload', 'utf8');
    const runtimeProject = { ...project, environments: [environment] };
    const runtime = bundle.browserRuntime;

    try {
      const session = await runtime.start({ project: runtimeProject, environment, record: false });
      expect(session.status).toBe('ready');
      const page = runtime.getPage();
      expect(page).not.toBeNull();
      const locator = (selector: string) => ({ selector, quality: 'acceptable' as const });

      await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'iframe', frame: { locator: locator('#same-origin-frame'), url: `${fixture.url}/frame` }, locator: locator('#frame-confirm') },
      });
      await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'tab', url: `${fixture.url}/help` },
      });
      await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'upload', locator: locator('#avatar'), fileRef: { kind: 'attachment', id: 'approved-avatar' } },
        resolveUploadPath: async () => uploadPath,
      });
      const download = await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'download', locator: locator('#download-report'), url: `${fixture.url}/report.csv` },
      });
      await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'hover', locator: locator('#account-menu') },
      });
      await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'drag', source: locator('#card-a'), target: locator('#column-done') },
      });
      await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'clipboard', locator: locator('#clipboard-target'), value: 'TEST_BUDDY_CLIPBOARD_SENTINEL' },
      });
      await page!.evaluate(() => setTimeout(() => fetch('/observed?token=must-not-persist'), 100));
      const observed = await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'networkObserve', url: `${fixture.url}/observed?token=must-not-persist`, method: 'GET' },
      });
      const mocked = await runtime.executeControlledDeterministicAction({
        runId: 'controlled-smoke-run',
        action: { kind: 'networkMock', url: `${fixture.url}/mocked`, method: 'GET', response: { status: 201, body: { mocked: true } } },
      });

      expect(await page!.evaluate(() => ({
        frameConfirmed: document.body.dataset.frameConfirmed,
        uploaded: document.body.dataset.uploaded,
        hovered: document.body.dataset.hovered,
        dropped: document.body.dataset.dropped,
      }))).toEqual({ frameConfirmed: 'yes', uploaded: 'approved-upload.txt', hovered: 'yes', dropped: 'yes' });
      await expect(page!.evaluate(() => fetch('/mocked').then((response) => response.text()))).resolves.toBe('{"mocked":true}');
      expect([...download.artifacts, ...observed.artifacts, ...mocked.artifacts]).toEqual([
        expect.objectContaining({ manifest: expect.objectContaining({ ownerRunId: 'controlled-smoke-run', evidenceKind: 'attachment' }) }),
        expect.objectContaining({ manifest: expect.objectContaining({ ownerRunId: 'controlled-smoke-run', evidenceKind: 'syntheticDiagnostic' }) }),
        expect.objectContaining({ manifest: expect.objectContaining({ ownerRunId: 'controlled-smoke-run', evidenceKind: 'syntheticDiagnostic' }) }),
      ]);
      await expect(fs.readFile(observed.artifacts[0]!.path, 'utf8')).resolves.not.toContain('token=must-not-persist');
    } finally {
      await bundle.close();
      await fixture.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it('does not start a second Case browser session after parent Suite cancellation', async () => {
    const fixture = await startFixture();
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-browser-suite-cancel-'));
    const bundle = createRuntimeBundle({
      rootDir,
      visualDiffImageAdapter: { read: async () => Buffer.alloc(0), write: async () => undefined },
    });
    const project = createEmptyProject(1);
    const environment = {
      ...project.environments[0]!,
      url: fixture.url,
      entryPath: '/',
      browser: 'chromium' as const,
      headless: true,
    };
    const first = browserStartCase(project, environment, 'case-browser-cancel-first', 1);
    const second = browserStartCase(project, environment, 'case-browser-cancel-second', 2);
    const suite = {
      ...createEmptySuiteAsset(project, 1),
      id: 'suite-browser-cancel',
      environmentId: environment.id,
      caseReferences: [
        { id: first.id, version: first.version!, dependsOn: [] },
        { id: second.id, version: second.version!, dependsOn: [] },
      ],
      execution: { concurrency: 1, failurePolicy: 'continue' as const, retryLimit: 0 },
    };
    const controller = new AbortController();
    const originalStart = bundle.browserRuntime.start.bind(bundle.browserRuntime);
    let starts = 0;
    bundle.browserRuntime.start = async (request) => {
      starts += 1;
      const session = await originalStart(request);
      controller.abort();
      return session;
    };
    const runtimeProject = { ...project, environments: [environment], testCases: [first, second], suites: [suite] };

    try {
      const response = await bundle.runSuite({
        runId: 'suite-browser-cancel-run',
        cancellationSignal: controller.signal,
        projectSnapshot: {
          project: runtimeProject,
          revision: 'b'.repeat(64),
          source: 'legacyStudioStore',
          reproducibility: 'legacy',
        },
        suite,
        environment,
      });

      expect(starts).toBe(1);
      expect(response.detail.suite).toMatchObject({
        status: 'cancelled',
        reason: { code: 'userCancelled' },
      });
      expect(response.detail.suite.results).toEqual([
        expect.objectContaining({
          testCaseId: first.id,
          status: 'cancelled',
          reason: expect.objectContaining({ code: 'userCancelled' }),
        }),
        expect.objectContaining({
          testCaseId: second.id,
          status: 'cancelled',
          reason: expect.objectContaining({ code: 'userCancelled' }),
          attempts: 0,
        }),
      ]);
    } finally {
      await bundle.close();
      await fixture.close();
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

function browserStartCase(
  project: ReturnType<typeof createEmptyProject>,
  environment: ReturnType<typeof createEmptyProject>['environments'][number],
  id: string,
  seed: number,
) {
  return {
    ...createEmptyTestCase(seed, project.groups[0]!.id, environment.id),
    id,
    version: 1,
    name: id,
    url: environment.url,
    steps: [
      {
        id: `${id}-navigate`,
        type: 'ai' as const,
        title: 'Open fixture',
        body: 'Open the local fixture.',
        execution: {
          schemaVersion: 2 as const,
          intent: 'Open the local fixture.',
          reviewStatus: 'confirmed' as const,
          actionRisk: 'low' as const,
          action: { kind: 'navigate' as const, url: environment.url },
        },
      },
    ],
  };
}

async function startFixture(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://fixture.local');
    if (requestUrl.pathname === '/frame') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<button id="frame-confirm" onclick="parent.document.body.dataset.frameConfirmed = \'yes\'">Confirm</button>');
      return;
    }
    if (requestUrl.pathname === '/report.csv') {
      response.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="report.csv"' });
      response.end('report,status\\nsmoke,passed\\n');
      return;
    }
    if (requestUrl.pathname === '/observed') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"observed":true}');
      return;
    }
    if (requestUrl.pathname === '/help') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<p>help</p>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html>
<html><head><title>Fixture</title></head>
<body>
  <button id="continue" onclick="document.body.dataset.continued = 'yes'">Continue</button>
  <iframe id="same-origin-frame" src="/frame"></iframe>
  <input id="avatar" type="file" onchange="document.body.dataset.uploaded = this.files[0]?.name || ''">
  <a id="download-report" href="/report.csv" download>Download</a>
  <div id="account-menu" onmouseenter="document.body.dataset.hovered = 'yes'">Account</div>
  <div id="card-a" draggable="true">Card</div>
  <div id="column-done" ondragover="event.preventDefault()" ondrop="event.preventDefault(); document.body.dataset.dropped = 'yes'">Done</div>
  <div id="clipboard-target">Clipboard</div>
  <p>ready</p>
</body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Fixture server did not bind to TCP.');
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
