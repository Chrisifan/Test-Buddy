import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ArtifactManager } from './artifact-manager.js';

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
});
