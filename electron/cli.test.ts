import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createEmptyProject, createInitialStudioState } from '../shared/studio.js';
import { executeCliCommand, parseCliArguments, renderJUnitReport, type CliRunSummary } from './cli.js';
import { StudioStore } from './studioStore.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe('TestBuddy CLI', () => {
  it('requires explicit stable data, project, and test case IDs', () => {
    expect(
      parseCliArguments([
        '--',
        'run',
        '--data-dir',
        '/workspace/testbuddy',
        '--project-id',
        'project-web',
        '--case-id',
        'case-login',
        '--case-id',
        'case-checkout',
        '--environment-id',
        'env-ci',
      ]),
    ).toEqual({
      kind: 'run',
      dataDir: '/workspace/testbuddy',
      projectId: 'project-web',
      caseIds: ['case-login', 'case-checkout'],
      environmentId: 'env-ci',
    });
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
      caseIds: ['case-agent'],
    });

    expect(summary.status).toBe('failed');
    expect(summary.results).toEqual([
      expect.objectContaining({ testCaseId: 'case-agent', status: 'failed', failureReason: 'Midscene 模型未配置。' }),
    ]);
    await expect(fs.readFile(summary.reports.junit, 'utf8')).resolves.toContain('Midscene 模型未配置。');
  });
});
