import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyProject, createInitialStudioState } from '../shared/studio.js';
import { executeCliCommand, parseCliArguments, renderJUnitReport, type CliRunSummary } from './cli.js';
import { ProjectAssetStore } from './projectAssetStore.js';
import { StudioStore } from './studioStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('TestBuddy CLI', () => {
  it('requires explicit versioned data, project, and test case references', () => {
    expect(
      parseCliArguments([
        '--',
        'run',
        '--data-dir',
        '/workspace/testbuddy',
        '--project-id',
        'project-web',
        '--case-id',
        'case-login@2',
        '--case-id',
        'case-checkout@4',
        '--environment-id',
        'env-ci',
      ]),
    ).toEqual({
      kind: 'run',
      dataDir: '/workspace/testbuddy',
      projectId: 'project-web',
      caseReferences: [{ id: 'case-login', version: 2 }, { id: 'case-checkout', version: 4 }],
      environmentId: 'env-ci',
    });
  });

  it('rejects bare Case IDs and de-duplicates exact Case references', () => {
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--case-id', 'case-login',
    ])).toThrow('--case-id 必须使用 <id@version> 格式。');
    expect(parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web',
      '--case-id', 'case-login@2', '--case-id', 'case-login@2',
    ])).toMatchObject({ caseReferences: [{ id: 'case-login', version: 2 }] });
  });

  it('accepts an exact immutable Suite reference and rejects ambiguous selection mixes', () => {
    expect(parseCliArguments([
      'run',
      '--data-dir',
      '/workspace/testbuddy',
      '--project-id',
      'project-web',
      '--suite-id',
      'release/core@2',
    ])).toEqual({
      kind: 'run',
      dataDir: '/workspace/testbuddy',
      projectId: 'project-web',
      caseReferences: [],
      suiteReference: { id: 'release/core', version: 2 },
    });
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--suite-id', 'release@1', '--case-id', 'case-login@1',
    ])).toThrow('不能同时使用');
    expect(() => parseCliArguments([
      'run', '--data-dir', '/workspace/testbuddy', '--project-id', 'project-web', '--suite-id', 'release',
    ])).toThrow('<id@version>');
  });

  it('rejects incomplete and unknown commands before it reads state', () => {
    expect(() => parseCliArguments(['run', '--data-dir', '/workspace/testbuddy'])).toThrow(
      '--project-id',
    );
    expect(() => parseCliArguments(['run', '--data-dir', '/workspace/testbuddy', '--all'])).toThrow(
      '未知选项',
    );
    expect(() => parseCliArguments(['inspect'])).toThrow('未知命令');
  });

  it('renders passed, failed, and incomplete results as portable JUnit XML', () => {
    const summary: CliRunSummary = {
      command: 'run',
      status: 'failed',
      dataDir: '/workspace/testbuddy',
      startedAt: '2026-08-03T00:00:00.000Z',
      endedAt: '2026-08-03T00:00:03.000Z',
      reports: { junit: '/workspace/testbuddy/report.xml' },
      results: [
        {
          projectId: 'project-web',
          testCaseId: 'case-passed',
          environmentId: 'env-ci',
          title: '登录成功',
          status: 'passed',
          duration: '00:00:01',
          summary: '通过',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-failed',
          environmentId: 'env-ci',
          title: '支付 <确认>',
          status: 'failed',
          duration: '00:00:02',
          summary: '失败',
          failureReason: '期望 "成功"，实际 <错误>',
          artifacts: [],
        },
        {
          projectId: 'project-web',
          testCaseId: 'case-neutral',
          environmentId: 'env-ci',
          title: '人工检查',
          status: 'neutral',
          summary: '等待人工结论',
          artifacts: [],
        },
      ],
    };

    const report = renderJUnitReport(summary);

    expect(report).toContain('tests="3" failures="1" errors="1" time="3.000"');
    expect(report).toContain('<failure message="期望 &quot;成功&quot;，实际 &lt;错误&gt;">');
    expect(report).toContain('<error type="incomplete" message="等待人工结论">');
    expect(report).toContain('name="支付 &lt;确认&gt;" time="2.000"');
  });

  it('creates CI reports from an explicit data directory without starting Electron', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    project.testCases = [
      {
        id: 'case-agent',
        kind: 'scenario',
        name: '需要模型的用例',
        category: '回归',
        lastEdited: new Date(0).toISOString(),
        url: environment.url,
        notes: '',
        groupId: project.groups[0]!.id,
        environmentId: environment.id,
        source: 'manual',
        steps: [{ id: 'step-agent', type: 'ai', title: '执行', body: '点击登录按钮' }],
      },
    ];
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);

    const summary = await executeCliCommand({
      kind: 'run',
      dataDir: directory,
      projectId: project.id,
      caseReferences: [{ id: 'case-agent', version: 1 }],
    });

    expect(summary.status).toBe('failed');
    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-agent', status: 'failed', failureReason: 'Midscene 模型未配置。' }),
    ]);
    await expect(fs.readFile(summary.reports.junit, 'utf8')).resolves.toContain('Midscene 模型未配置。');
  });

  it('runs a fixed Suite reference through the shared scheduler without allowing an environment override', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-suite-'));
    temporaryDirectories.push(directory);
    const project = createEmptyProject(1);
    const environment = project.environments[0]!;
    project.testCases = [{
      id: 'case-agent',
      kind: 'scenario',
      name: '需要模型的 Suite 用例',
      category: '回归',
      lastEdited: new Date(0).toISOString(),
      url: environment.url,
      notes: '',
      groupId: project.groups[0]!.id,
      environmentId: environment.id,
      source: 'manual',
      steps: [{ id: 'step-agent', type: 'ai', title: '执行', body: '点击登录按钮' }],
    }];
    project.suites = [{
      schemaVersion: 1,
      id: 'suite-release',
      version: 1,
      name: '发布 Suite',
      description: '',
      tags: ['release'],
      environmentId: environment.id,
      caseReferences: [{ id: 'case-agent', version: 1, dependsOn: [] }],
      execution: { concurrency: 3, failurePolicy: 'failFast', retryLimit: 0 },
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    }];
    const state = createInitialStudioState();
    state.projects = [project];
    await new StudioStore(directory).save(state);

    const summary = await executeCliCommand({
      kind: 'run',
      dataDir: directory,
      projectId: project.id,
      caseReferences: [],
      suiteReference: { id: 'suite-release', version: 1 },
    });

    expect(summary.status).toBe('failed');
    expect(summary.suite).toMatchObject({ id: 'suite-release', version: 1, status: 'failed', effectiveConcurrency: 1, issues: [] });
    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-agent', status: 'failed', attempts: 1, flaky: false }),
    ]);
    expect(() => parseCliArguments([
      'run', '--data-dir', directory, '--project-id', project.id, '--suite-id', 'suite-release@1', '--environment-id', environment.id,
    ])).toThrow('固定目标环境');
  });

  it('runs the exact Case revision from a bound project snapshot instead of a newer StudioStore draft', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'testbuddy-cli-bound-case-'));
    temporaryDirectories.push(directory);
    const snapshotProject = createEmptyProject(1);
    const environment = snapshotProject.environments[0]!;
    snapshotProject.id = 'project-bound-case';
    snapshotProject.testCases = [{
      id: 'case-login', version: 1, kind: 'scenario', name: 'Snapshot Case v1', category: '回归', lastEdited: '',
      url: environment.url, notes: '', groupId: snapshotProject.groups[0]!.id, environmentId: environment.id,
      source: 'manual', steps: [{ id: 'step-v1', type: 'ai', title: '执行 v1', body: '执行 v1' }],
    }];
    const projectDirectory = path.join(directory, 'bound-project');
    const assetStore = new ProjectAssetStore(projectDirectory);
    await assetStore.saveInitial(snapshotProject);
    const snapshot = await assetStore.loadWithRevision();
    const stateProject = structuredClone(snapshotProject);
    stateProject.testCases = [{
      ...stateProject.testCases[0]!, version: 2, name: 'Mutable StudioStore Case v2', steps: [{ id: 'step-v2', type: 'manual', title: '执行 v2', body: '执行 v2' }],
    }];
    const state = createInitialStudioState();
    state.projects = [stateProject];
    state.projectAssetBindings = [{
      projectId: snapshotProject.id,
      projectDirectory,
      revision: snapshot.revision,
      boundAt: '2026-08-14T00:00:00.000Z',
    }];
    await new StudioStore(directory).save(state);

    const command = parseCliArguments([
      'run', '--data-dir', directory, '--project-id', snapshotProject.id, '--case-id', 'case-login@1',
    ]);
    if (command.kind === 'help') throw new Error('Expected run command.');
    const summary = await executeCliCommand(command);

    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-login', title: 'Snapshot Case v1', status: 'failed' }),
    ]);
  });
});
