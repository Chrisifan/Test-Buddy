import { createHash } from 'node:crypto';
import { ChildProcess, type ChildProcess as ChildProcessType } from 'node:child_process';
import { PassThrough, Writable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { FixtureAsset, FixtureScriptTrustRecord, ProjectEnvironment } from '../../shared/studio.js';
import { FixtureScriptExecutor } from './fixture-script-executor.js';

const temporaryDirectories: string[] = [];

const environment: ProjectEnvironment = {
  id: 'env-staging',
  name: 'Staging',
  kind: 'staging',
  url: 'https://app.example.test/orders',
  entryPath: '/orders',
  browser: 'chromium',
  viewport: 'desktop',
  locale: 'zh-CN',
  headless: true,
};

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('FixtureScriptExecutor', () => {
  it('runs an exact trusted self-contained setup script without leaking its result into evidence', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const source = [
      'let input = "";',
      'process.stdin.on("data", (chunk) => { input += chunk; });',
      'process.stdin.on("end", () => {',
      '  const context = JSON.parse(input);',
      '  if (context.lifecycle !== "setup") process.exit(2);',
      '  process.stderr.write("transient diagnostic");',
      '  process.stdout.write(JSON.stringify({ status: "passed", outputs: { orderId: "script-order-123" } }));',
      '});',
    ].join('\n');
    const fixture = await createScriptFixture(projectDirectory, source);
    const executor = new FixtureScriptExecutor();

    const result = await executor.execute(createRequest(fixture, projectDirectory));

    expect(result.evidence).toEqual(expect.objectContaining({
      mode: 'script',
      scriptPath: 'scripts/seed-orders.mjs',
      outcome: 'passed',
    }));
    expect(result.outputValues).toEqual({ orderId: 'script-order-123' });
    expect(JSON.stringify({ evidence: result.evidence, message: result.message })).not.toContain('script-order-123');
    expect(JSON.stringify({ evidence: result.evidence, message: result.message })).not.toContain('transient diagnostic');
  });

  it('rejects a changed or non-self-contained script before it can run', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const fixture = await createScriptFixture(projectDirectory, 'process.stdout.write(JSON.stringify({ status: "passed" }));');
    await fs.writeFile(path.join(projectDirectory, 'scripts', 'seed-orders.mjs'), 'import fs from "node:fs";\nprocess.exit(0);');

    const result = await new FixtureScriptExecutor().execute(createRequest(fixture, projectDirectory));

    expect(result.evidence).toEqual(expect.objectContaining({ mode: 'script', outcome: 'failed' }));
    expect(result.outputValues).toBeUndefined();
  });

  it('requires a matching local trust record even when the script content hash is valid', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const fixture = await createScriptFixture(projectDirectory, 'process.stdout.write(JSON.stringify({ status: "passed", outputs: { orderId: "unused" } }));');
    const request = createRequest(fixture, projectDirectory);

    const result = await new FixtureScriptExecutor().execute({ ...request, scriptTrustRecords: [] });

    expect(result.evidence).toEqual(expect.objectContaining({ mode: 'script', outcome: 'neutral' }));
    expect(result.outputValues).toBeUndefined();
  });

  it('does not follow a linked script directory outside the bound project', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const source = 'process.stdout.write(JSON.stringify({ status: "passed", outputs: { orderId: "unused" } }));';
    const fixture = await createScriptFixture(projectDirectory, source);
    const outsideDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-fixture-script-outside-'));
    temporaryDirectories.push(outsideDirectory);
    await fs.writeFile(path.join(outsideDirectory, 'seed-orders.mjs'), source);
    await fs.rm(path.join(projectDirectory, 'scripts'), { recursive: true });
    await fs.symlink(outsideDirectory, path.join(projectDirectory, 'scripts'));

    const result = await new FixtureScriptExecutor().execute(createRequest(fixture, projectDirectory));

    expect(result.evidence).toEqual(expect.objectContaining({ mode: 'script', outcome: 'failed' }));
    expect(result.outputValues).toBeUndefined();
  });

  it('rejects undeclared or invalid script outputs without persisting the raw stdout', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const fixture = await createScriptFixture(
      projectDirectory,
      'process.stdout.write(JSON.stringify({ status: "passed", outputs: { token: "should-not-pass" } }));',
    );

    const result = await new FixtureScriptExecutor().execute(createRequest(fixture, projectDirectory));

    expect(result.evidence).toEqual(expect.objectContaining({ mode: 'script', outcome: 'failed' }));
    expect(result.outputValues).toBeUndefined();
    expect(JSON.stringify({ evidence: result.evidence, message: result.message })).not.toContain('should-not-pass');
  });

  it('terminates a trusted script on timeout or cancellation', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const source = 'setInterval(() => undefined, 1_000);';
    const fixture = await createScriptFixture(projectDirectory, source);

    const timeoutResult = await new FixtureScriptExecutor({ timeoutMs: 30 }).execute(createRequest(fixture, projectDirectory));
    expect(timeoutResult.evidence).toEqual(expect.objectContaining({ mode: 'script', outcome: 'failed' }));
    expect(timeoutResult.message).toContain('timed out');

    const controller = new AbortController();
    const pending = new FixtureScriptExecutor({ timeoutMs: 1_000 }).execute(createRequest(fixture, projectDirectory, controller.signal));
    controller.abort();
    await expect(pending).resolves.toEqual(expect.objectContaining({
      evidence: expect.objectContaining({ mode: 'script', outcome: 'neutral' }),
    }));
  });

  it('contains a broken stdin pipe when the fixture child exits before receiving its request', async () => {
    const projectDirectory = await createTemporaryProjectDirectory();
    const fixture = await createScriptFixture(
      projectDirectory,
      'process.stdout.write(JSON.stringify({ status: "passed", outputs: { orderId: "unused" } }));',
    );
    const child = createBrokenStdinChild();
    const executor = new FixtureScriptExecutor({ spawn: () => child as never });

    await expect(executor.execute(createRequest(fixture, projectDirectory))).resolves.toEqual(expect.objectContaining({
      evidence: expect.objectContaining({ mode: 'script', outcome: 'failed' }),
    }));
  });
});

function createBrokenStdinChild(): ChildProcessType {
  const child = new ChildProcess();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    },
  });
  Object.assign(child, {
    exitCode: null,
    signalCode: null,
    stdin,
    stdout,
    stderr,
    kill: () => {
      stdout.end();
      stderr.end();
      child.emit('close', 1);
      return true;
    },
  });
  return child;
}

async function createTemporaryProjectDirectory(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-fixture-script-'));
  temporaryDirectories.push(directory);
  await fs.mkdir(path.join(directory, 'scripts'));
  return directory;
}

async function createScriptFixture(projectDirectory: string, source: string): Promise<FixtureAsset> {
  const relativePath = 'scripts/seed-orders.mjs';
  await fs.writeFile(path.join(projectDirectory, relativePath), source);
  return {
    schemaVersion: 1,
    id: 'fixture-script-orders',
    version: 2,
    name: '准备脚本订单数据',
    description: '',
    inputs: [],
    outputs: [{ name: 'orderId', type: 'string', required: true }],
    credentialIds: [],
    environmentIds: [environment.id],
    setup: {
      mode: 'script',
      summary: '创建订单。',
      script: {
        relativePath,
        contentHash: createHash('sha256').update(source).digest('hex'),
        requiredEnvironment: [],
      },
    },
    concurrency: 'exclusive',
    resourceLocks: ['orders'],
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function createRequest(fixture: FixtureAsset, projectDirectory: string, cancellationSignal?: AbortSignal) {
  const trustRecord: FixtureScriptTrustRecord = {
    schemaVersion: 1,
    projectId: 'project-orders',
    projectDirectory,
    fixtureId: fixture.id,
    fixtureVersion: fixture.version,
    lifecycle: 'setup',
    relativePath: fixture.setup.script!.relativePath,
    contentHash: fixture.setup.script!.contentHash,
    approvedAt: new Date(0).toISOString(),
  };
  return {
    fixture,
    lifecycle: 'setup' as const,
    environment,
    projectId: 'project-orders',
    projectDirectory,
    scriptTrustRecords: [trustRecord],
    ...(cancellationSignal ? { cancellationSignal } : {}),
  };
}
