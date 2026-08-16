import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArtifactManager, renderProjectRunReportHtml } from './artifact-manager.js';

describe('ArtifactManager', () => {
  it('persists reporter markdown and html reports under the artifacts directory', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    const report = await artifacts.createReporterReport(
      'agent-run-1',
      'Reporter 失败分析',
      '# Reporter 判断\n\n## 失败归因\n图表 <未刷新>。',
    );

    expect(report.markdown).toEqual(
      expect.objectContaining({
        type: 'report',
        label: 'Reporter 失败分析',
        path: path.join(rootDir, 'studio-data', 'artifacts', 'agent-run-1-reporter.md'),
      }),
    );
    expect(report.html).toEqual(
      expect.objectContaining({
        type: 'report',
        label: 'Reporter HTML 报告',
        path: path.join(rootDir, 'studio-data', 'artifacts', 'agent-run-1-reporter.html'),
      }),
    );
    await expect(fs.readFile(report.markdown.path, 'utf8')).resolves.toContain('图表 <未刷新>');
    const html = await fs.readFile(report.html.path, 'utf8');
    expect(html).toContain('<h1>Reporter 判断</h1>');
    expect(html).toContain('<h2>失败归因</h2>');
    expect(html).toContain('图表 &lt;未刷新&gt;');
  });

  it('accepts only paths inside the managed artifacts directory', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    const report = await artifacts.createMarkdownReport('agent-run-2', 'Reporter 失败分析', '# Report');

    expect(artifacts.isManagedArtifactPath(report.path)).toBe(true);
    expect(artifacts.isManagedArtifactPath(path.join(rootDir, 'studio-data', 'state.json'))).toBe(false);
    expect(artifacts.isManagedArtifactPath(path.join(rootDir, 'studio-data', 'artifacts-copy', 'report.html'))).toBe(false);
    expect(artifacts.isManagedArtifactPath('/tmp/unrelated-report.html')).toBe(false);
  });

  it('renders an escaped project management report without local artifact paths', async () => {
    const report = {
      generatedAt: '2026-08-04T00:00:00.000Z',
      projectName: '订单 <回归>',
      runStats: { running: 0, passed: 1, failed: 1, blocked: 1, skipped: 1, cancelled: 1, error: 1 },
      coverageRisk: {
        total: 6,
        verified: 0,
        risks: [
          { testCaseName: '从未 <执行>', groupName: '交易', environmentName: 'Staging', status: 'neverExecuted' as const },
          { testCaseName: '失败 <确认>', groupName: '交易', environmentName: 'Staging', status: 'failed' as const },
          { testCaseName: '错误 <确认>', groupName: '交易', environmentName: 'Staging', status: 'error' as const },
          { testCaseName: '阻断 <确认>', groupName: '交易', environmentName: 'Staging', status: 'blocked' as const },
          { testCaseName: '跳过 <确认>', groupName: '交易', environmentName: 'Staging', status: 'skipped' as const },
          { testCaseName: '取消 <确认>', groupName: '交易', environmentName: 'Staging', status: 'cancelled' as const },
        ],
      },
      prdCoverage: {
        paths: 1,
        targets: {
          case: { pending: 0, deferred: 0, ignored: 0, resolved: 1 },
          recording: { pending: 1, deferred: 0, ignored: 0, resolved: 0 },
        },
      },
      problemRuns: [{
        id: 'run-1', testCaseName: '支付 <确认>', environmentName: 'Staging', status: 'error' as const, startedAt: '2026-08-04T00:00:00.000Z', duration: '00:00:01', summary: '失败 <详情>', artifactLabels: ['报告 <HTML>'],
      }],
      nonExecutedRuns: [{
        id: 'run-2', testCaseName: '准备 <夹具>', environmentName: 'Staging', status: 'blocked' as const, startedAt: '2026-08-04T00:01:00.000Z', duration: '00:00:01', summary: '夹具尚未准备。', reason: { code: 'fixturePreflight' as const, message: '夹具 <未准备>' }, artifactLabels: ['准备 <记录>'],
      }],
    };
    const html = renderProjectRunReportHtml(report, 'zh-CN');
    const englishHtml = renderProjectRunReportHtml(report, 'en-US');

    expect(html).toContain('订单 &lt;回归&gt;');
    expect(html).toContain('支付 &lt;确认&gt;');
    expect(html).toContain('报告 &lt;HTML&gt;');
    expect(html).toContain('准备 &lt;夹具&gt;');
    expect(html).toContain('fixturePreflight · 夹具 &lt;未准备&gt;');
    expect(html).toContain('运行中');
    expect(html).toContain('通过');
    expect(html).toContain('失败');
    expect(html).toContain('阻断');
    expect(html).toContain('跳过');
    expect(html).toContain('已取消');
    expect(html).toContain('错误');
    expect(html).toContain('从未执行');
    expect(html).toContain('最近失败');
    expect(html).toContain('最近错误');
    expect(html).toContain('最近阻断');
    expect(html).toContain('最近跳过');
    expect(html).toContain('最近取消');
    expect(englishHtml).toContain('Running');
    expect(englishHtml).toContain('Passed');
    expect(englishHtml).toContain('Failed');
    expect(englishHtml).toContain('Blocked');
    expect(englishHtml).toContain('Skipped');
    expect(englishHtml).toContain('Cancelled');
    expect(englishHtml).toContain('Error');
    expect(englishHtml).toContain('Never executed');
    expect(englishHtml).toContain('Last run failed');
    expect(englishHtml).toContain('Last run errored');
    expect(englishHtml).toContain('Last run blocked');
    expect(englishHtml).toContain('Last run skipped');
    expect(englishHtml).toContain('Last run cancelled');
    expect(html).not.toContain('artifact.path');
    expect(html).not.toContain('modelApiKey');
  });

  it('allocates trace archives only inside managed artifact storage', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    const tracePath = await artifacts.createTracePath('agent/run:1');

    expect(tracePath).toMatch(
      new RegExp(`^${escapeRegExp(path.join(rootDir, 'studio-data', 'artifacts'))}.+agent-run-1.+-trace\\.zip$`),
    );
    expect(artifacts.isManagedArtifactPath(tracePath)).toBe(true);
  });

  it('exports a managed artifact to a user-selected destination', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);
    const report = await artifacts.createMarkdownReport('agent-run-3', 'Reporter 失败分析', '# Exported report');
    const destinationPath = path.join(rootDir, 'exports', 'agent-run-3-report.md');

    await artifacts.exportArtifact(report.path, destinationPath);

    await expect(fs.readFile(destinationPath, 'utf8')).resolves.toBe('# Exported report');
    await expect(artifacts.exportArtifact('/tmp/unrelated-report.md', destinationPath)).rejects.toThrow(
      '只能导出应用生成的证据文件。',
    );
  });

  it('imports a user-selected manual evidence file into managed storage', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const sourcePath = path.join(rootDir, 'selected-evidence.txt');
    await fs.writeFile(sourcePath, '订单号和付款金额已核对。', 'utf8');
    const artifacts = new ArtifactManager(rootDir);

    const attachment = await artifacts.importManualEvidence(sourcePath);

    expect(attachment).toMatchObject({
      type: 'attachment',
      label: 'selected-evidence.txt',
    });
    expect(attachment.path).toMatch(new RegExp(`^${escapeRegExp(path.join(rootDir, 'studio-data', 'artifacts'))}.+\\.txt$`));
    expect(artifacts.isManagedArtifactPath(attachment.path)).toBe(true);
    await expect(fs.readFile(attachment.path, 'utf8')).resolves.toBe('订单号和付款金额已核对。');
  });

  it('rejects directories as manual evidence', async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'playtest-artifacts-'));
    const artifacts = new ArtifactManager(rootDir);

    await expect(artifacts.importManualEvidence(rootDir)).rejects.toThrow('只能附加文件证据。');
  });
});

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
